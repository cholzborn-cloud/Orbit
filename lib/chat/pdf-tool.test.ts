import { spawnSync, type ChildProcess } from "node:child_process"
import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { PassThrough } from "node:stream"
import test from "node:test"
import {
  createPdfTool,
  renderPdf,
  createWordTool,
  renderWord,
} from "./pdf-tool.ts"

const input = {
  filename: "Grüße.pdf",
  text: "Grüße aus München: äöü ß €\n$(touch nope); <script>",
}

function fakeProcess(run: (child: ReturnType<typeof fakeChild>) => void) {
  const child = fakeChild()
  const start: NonNullable<Parameters<typeof renderPdf>[2]> = (
    command,
    args,
    options
  ) => {
    assert.equal(command, "/usr/sbin/cupsfilter")
    assert.deepEqual(args, ["-i", "text/plain", "-m", "application/pdf"])
    assert.deepEqual(options.env, {
      PATH: "/usr/bin:/bin",
      LANG: "en_US.UTF-8",
    })
    assert.equal(options.shell, false)
    queueMicrotask(() => run(child))
    return child as unknown as ChildProcess
  }
  return { child, start }
}

function fakeChild() {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    killed: false,
    kill(signal: string) {
      assert.equal(signal, "SIGKILL")
      child.killed = true
      return true
    },
  })
  return child
}

test("fixed converter, Unicode stdin and byte-free model output", async () => {
  let received = ""
  const { child, start } = fakeProcess((child) => {
    child.stdout.write("%PDF-1.7\nexample")
    child.emit("close", 0)
  })
  child.stdin.on("data", (chunk) => {
    received += chunk.toString("utf8")
  })
  const result = await renderPdf(input, {}, start)
  assert.equal(received, input.text)
  assert.ok("data" in result)
  assert.equal(
    Buffer.from(result.data, "base64").toString(),
    "%PDF-1.7\nexample"
  )
  const model = await createPdfTool().toModelOutput!({
    output: result,
    input,
    toolCallId: "pdf",
  })
  assert.equal(JSON.stringify(model).includes(result.data), false)
  assert.deepEqual(model, {
    type: "json",
    value: { filename: input.filename, mediaType: "application/pdf", size: 16 },
  })
})

test("rejects invalid names, empty and oversized UTF-8 input before spawn", async () => {
  const never = (() => {
    assert.fail("must not spawn")
  }) as Parameters<typeof renderPdf>[2]
  for (const filename of [
    "../x.pdf",
    "/x.pdf",
    "a\\x.pdf",
    "x.pdf\n",
    "x.txt",
    "--x.pdf",
    "a..pdf",
  ])
    assert.ok("error" in (await renderPdf({ ...input, filename }, {}, never)))
  for (const text of ["", "a\0b", "ü".repeat(140_000)])
    assert.ok("error" in (await renderPdf({ ...input, text }, {}, never)))
})

test("bounded output kills process; stderr is drained and never exposed", async () => {
  const { child, start } = fakeProcess((child) => {
    child.stderr.write("secret private content")
    child.stdout.write(Buffer.alloc(5 * 1024 * 1024 + 1))
  })
  const result = await renderPdf(input, {}, start)
  assert.equal(child.killed, true)
  assert.deepEqual(result, { error: "PDF ist größer als 5 MiB." })
})

test("handles process, pipe, exit and invalid-output errors", async () => {
  for (const event of [
    "process",
    "stdin",
    "stdout",
    "stderr",
    "exit",
    "invalid",
  ] as const) {
    const { start } = fakeProcess((child) => {
      if (event === "process") child.emit("error", new Error("secret"))
      else if (event === "exit") child.emit("close", 1)
      else if (event === "invalid") {
        child.stdout.write("invalid")
        child.emit("close", 0)
      } else child[event].emit("error", new Error("secret"))
    })
    const result = await renderPdf(input, {}, start)
    assert.ok("error" in result)
    assert.equal(JSON.stringify(result).includes("secret"), false)
  }
  assert.deepEqual(
    await renderPdf(input, {}, () => {
      throw new Error("PDF secret native error")
    }),
    { error: "PDF-Erstellung ist nicht verfügbar." }
  )
})

test("abort before spawn and during conversion", async () => {
  const controller = new AbortController()
  const { child, start } = fakeProcess(() => controller.abort())
  assert.deepEqual(
    await renderPdf(input, { signal: controller.signal }, start),
    { error: "PDF-Erstellung abgebrochen." }
  )
  assert.equal(child.killed, true)
  assert.deepEqual(
    await renderPdf(input, { signal: controller.signal }, () => {
      assert.fail("must not spawn")
    }),
    { error: "PDF-Erstellung abgebrochen." }
  )
})

test("timeout kills converter", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] })
  const { child, start } = fakeProcess(() => {})
  const pending = renderPdf(input, {}, start)
  context.mock.timers.tick(15_000)
  assert.deepEqual(await pending, {
    error: "PDF-Erstellung hat zu lange gedauert.",
  })
  assert.equal(child.killed, true)
})

test(
  "native cupsfilter converts German text",
  { skip: process.platform !== "darwin" },
  async () => {
    const result = await renderPdf(input)
    assert.ok("data" in result, JSON.stringify(result))
    assert.ok(
      Buffer.from(result.data, "base64")
        .subarray(0, 5)
        .equals(Buffer.from("%PDF-"))
    )
    assert.ok(result.size > 0 && result.size <= 5 * 1024 * 1024)
  }
)

const wordInput = { ...input, filename: "Grüße.docx" }
const docx = Buffer.from("PK\x03\x04word/document.xml [Content_Types].xml")

function fakeWordProcess(run: (child: ReturnType<typeof fakeChild>) => void) {
  const child = fakeChild()
  const start: NonNullable<Parameters<typeof renderWord>[2]> = (
    command,
    args,
    options
  ) => {
    assert.equal(command, "/usr/bin/textutil")
    assert.deepEqual(args, [
      "-convert",
      "docx",
      "-format",
      "txt",
      "-inputencoding",
      "UTF-8",
      "-stdin",
      "-stdout",
    ])
    assert.deepEqual(options, {
      env: { PATH: "/usr/bin:/bin", LANG: "en_US.UTF-8" },
      shell: false,
      stdio: "pipe",
    })
    queueMicrotask(() => run(child))
    return child as unknown as ChildProcess
  }
  return { child, start }
}

test("Word uses fixed converter and Unicode stdin with byte-free model output", async () => {
  let received = ""
  const { child, start } = fakeWordProcess((child) => {
    child.stdout.write(docx)
    child.emit("close", 0)
  })
  child.stdin.on("data", (chunk) => {
    received += chunk.toString("utf8")
  })
  const result = await renderWord(wordInput, {}, start)
  assert.equal(received, wordInput.text)
  assert.ok("data" in result)
  assert.deepEqual(Buffer.from(result.data, "base64"), docx)
  const model = await createWordTool().toModelOutput!({
    output: result,
    input: wordInput,
    toolCallId: "word",
  })
  assert.deepEqual(model, {
    type: "json",
    value: {
      filename: wordInput.filename,
      mediaType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      size: docx.length,
    },
  })
})

test("Word rejects invalid names and input before starting a process", async () => {
  const never = () => {
    assert.fail("must not spawn")
  }
  for (const filename of [
    "../x.docx",
    "/x.docx",
    "a\\x.docx",
    "x.docx\n",
    "x.pdf",
    "--x.docx",
    "a..docx",
    "a".repeat(121) + ".docx",
  ])
    assert.ok(
      "error" in (await renderWord({ ...wordInput, filename }, {}, never))
    )
  for (const text of ["", "a\0b", "ü".repeat(140_000)])
    assert.ok("error" in (await renderWord({ ...wordInput, text }, {}, never)))
})

test("Word bounds output and suppresses converter and pipe errors", async () => {
  const oversized = fakeWordProcess((child) => {
    child.stderr.write("private secret")
    child.stdout.write(Buffer.alloc(5 * 1024 * 1024 + 1))
  })
  assert.deepEqual(await renderWord(wordInput, {}, oversized.start), {
    error: "Word ist größer als 5 MiB.",
  })
  assert.equal(oversized.child.killed, true)
  for (const event of [
    "process",
    "stdin",
    "stdout",
    "stderr",
    "exit",
    "empty",
    "invalid",
    "zip",
  ] as const) {
    const { start } = fakeWordProcess((child) => {
      if (event === "process") child.emit("error", new Error("secret"))
      else if (event === "exit") child.emit("close", 1)
      else if (event === "empty") child.emit("close", 0)
      else if (event === "invalid" || event === "zip") {
        child.stdout.write(
          event === "zip" ? "PK\x03\x04unrelated zip" : "invalid"
        )
        child.emit("close", 0)
      } else child[event].emit("error", new Error("secret"))
    })
    const result = await renderWord(wordInput, {}, start)
    assert.ok("error" in result)
    assert.equal(JSON.stringify(result).includes("secret"), false)
  }
  assert.deepEqual(
    await renderWord(wordInput, {}, () => {
      throw new Error("secret")
    }),
    { error: "Word-Erstellung ist nicht verfügbar." }
  )
})

test("Word abort before spawn and during conversion", async () => {
  const controller = new AbortController()
  const { child, start } = fakeWordProcess(() => controller.abort())
  assert.deepEqual(
    await renderWord(wordInput, { signal: controller.signal }, start),
    { error: "Word-Erstellung abgebrochen." }
  )
  assert.equal(child.killed, true)
  assert.deepEqual(
    await renderWord(wordInput, { signal: controller.signal }, () => {
      assert.fail("must not spawn")
    }),
    { error: "Word-Erstellung abgebrochen." }
  )
})

test("Word timeout kills converter", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] })
  const { child, start } = fakeWordProcess(() => {})
  const pending = renderWord(wordInput, {}, start)
  context.mock.timers.tick(15_000)
  assert.deepEqual(await pending, {
    error: "Word-Erstellung hat zu lange gedauert.",
  })
  assert.equal(child.killed, true)
})

test(
  "native textutil produces a Word document preserving German text",
  { skip: process.platform !== "darwin" },
  async () => {
    const result = await renderWord(wordInput)
    assert.ok("data" in result, JSON.stringify(result))
    const converted = spawnSync(
      "/usr/bin/textutil",
      [
        "-convert",
        "txt",
        "-format",
        "docx",
        "-encoding",
        "UTF-8",
        "-stdin",
        "-stdout",
      ],
      {
        input: Buffer.from(result.data, "base64"),
        env: { PATH: "/usr/bin:/bin", LANG: "en_US.UTF-8" },
        timeout: 15_000,
        maxBuffer: 5 * 1024 * 1024,
      }
    )
    assert.equal(converted.status, 0)
    assert.equal(converted.stdout.toString("utf8").trimEnd(), wordInput.text)
  }
)
