const MEDIA_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odt: "application/vnd.oasis.opendocument.text",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  odp: "application/vnd.oasis.opendocument.presentation",
  rtf: "application/rtf",
  zip: "application/zip",
  gz: "application/gzip",
  tar: "application/x-tar",
  json: "application/json",
  csv: "text/csv",
  md: "text/markdown",
  html: "text/html",
  txt: "text/plain",
  mp4: "video/mp4",
  mp3: "audio/mpeg",
  wav: "audio/wav",
}

export const mediaTypeOf = (name: string) =>
  MEDIA_TYPES[name.split(".").pop()?.toLowerCase() ?? ""] ??
  "application/octet-stream"
