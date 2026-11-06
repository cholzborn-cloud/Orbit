import { EventSourceParserStream } from "@ai-sdk/provider-utils"

import { DefaultChatTransport, type UIMessage } from "ai"

import type { ChatMetadata } from "@/lib/chat-catalog"
import type { AskUserOutput } from "@/lib/chat/ask-user"
import type { sendMetadata } from "@/lib/chat/metadata"

type ClientData = ReturnType<typeof sendMetadata>

export class ServiceChatTransport extends DefaultChatTransport<
  UIMessage<ChatMetadata>
> {
  private clientData: ClientData | undefined
  private readonly chatUrl: string
  private readonly baseUrl: string
  private readonly accessHeaders: Record<string, string>

  constructor(url: string, token: string, chatId: string) {
    const base = new URL(url)
    if (
      base.protocol !== "http:" ||
      base.hostname !== "127.0.0.1" ||
      base.username ||
      base.password ||
      base.pathname !== "/" ||
      base.search ||
      base.hash
    )
      throw new Error("Ungültige Adresse des lokalen Dienstes.")
    const chatUrl = `${base.origin}/v1/chats/${encodeURIComponent(chatId)}`
    const headers = { Authorization: `Bearer ${token}` }
    super({
      api: `${chatUrl}/turn`,
      headers,
      credentials: "omit",
      resumeStreamIsReplay: true,
      prepareSendMessagesRequest: ({
        messages,
        trigger,
        messageId,
        requestMetadata,
      }) => ({
        body: {
          messages,
          trigger,
          messageId,
          clientData: requestMetadata ?? this.clientData,
        },
      }),
      prepareReconnectToStreamRequest: () => ({ api: `${chatUrl}/stream` }),
    })
    this.baseUrl = base.origin
    this.chatUrl = chatUrl
    this.accessHeaders = headers
  }

  setClientData(data: ClientData) {
    this.clientData = data
  }

  async request(
    path: "messages" | "stop",
    method: "GET" | "POST" | "DELETE",
    signal?: AbortSignal
  ) {
    return this.fetchApi(`${this.chatUrl}/${path}`, method, undefined, signal)
  }

  private async fetchApi(
    url: string,
    method: string,
    body?: unknown,
    signal?: AbortSignal
  ) {
    const response = await fetch(url, {
      method,
      headers: {
        ...this.accessHeaders,
        ...(body !== undefined && { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "omit",
      signal,
    })
    if (!response.ok) {
      throw new Error(
        response.status === 409
          ? "Die Antwort läuft noch. Bitte zuerst stoppen."
          : "Der lokale Dienst ist nicht erreichbar oder hat die Anfrage abgelehnt."
      )
    }
    return response
  }

  async decideApproval(id: string, decision: "once" | "always" | "deny") {
    await this.fetchApi(
      `${this.baseUrl}/v1/approvals/${encodeURIComponent(id)}/decide`,
      "POST",
      { decision }
    )
  }

  async answerQuestion(toolCallId: string, output: AskUserOutput) {
    await this.fetchApi(
      `${this.baseUrl}/v1/questions/${encodeURIComponent(toolCallId)}/answer`,
      "POST",
      output
    )
  }

  async subscribeEvents(
    onEvent: (event: Record<string, unknown>) => void,
    signal: AbortSignal
  ) {
    const response = await this.fetchApi(
      `${this.baseUrl}/v1/events`,
      "GET",
      undefined,
      signal
    )
    if (!response.body)
      throw new Error("Die Statusverbindung des lokalen Dienstes ist leer.")
    const reader = response.body
      .pipeThrough(new TextDecoderStream())
      .pipeThrough(new EventSourceParserStream())
      .getReader()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const event: unknown = JSON.parse(value.data)
        if (event && typeof event === "object" && !Array.isArray(event))
          onEvent(event as Record<string, unknown>)
      }
      if (!signal.aborted)
        throw new Error(
          "Die Statusverbindung des lokalen Dienstes wurde unterbrochen."
        )
    } finally {
      reader.releaseLock()
    }
  }

  async loadMessages(signal?: AbortSignal): Promise<UIMessage<ChatMetadata>[]> {
    const response = await this.request("messages", "GET", signal)
    const data = await response.json()
    if (!Array.isArray(data.messages))
      throw new Error("Der gespeicherte Verlauf ist ungültig.")
    return data.messages
  }
}
