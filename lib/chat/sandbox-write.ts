// Nur gewöhnliche Pfade unter dem Sandbox-Heimatordner sind für Auto geeignet.
export const MAX_AUTO_WRITE = 60 * 1024

export function ordinarySandboxPath(value: unknown): value is string {
  if (typeof value !== "string" || !value || value.length > 4096) return false
  const path = value.startsWith("/home/daytona/")
    ? value.slice("/home/daytona/".length)
    : value
  return (
    !path.startsWith("/") &&
    path.split("/").every((part) => /^[A-Za-z0-9_][A-Za-z0-9_. -]*$/.test(part))
  )
}

export function autoOutputPath(value: unknown): value is string {
  if (!ordinarySandboxPath(value)) return false
  const path = value.startsWith("/home/daytona/") ? value.slice("/home/daytona/".length) : value
  return path.startsWith("output/") && path.length > "output/".length
}

// Verzeichnis-Deskriptoren verhindern, dass Symlinks das Ziel nach außen umlenken.
export const SAFE_WRITE_SCRIPT = `
import base64, os, secrets
root = os.environ['ORBIT_WRITE_ROOT']
path = os.environ['ORBIT_WRITE_PATH']
if path.startswith('/home/daytona/'):
    path = path[len('/home/daytona/'):]
parts = path.split('/')
if not parts or any(not p or p in ('.', '..') or '/' in p for p in parts):
    raise ValueError('invalid path')
data = base64.b64decode(os.environ['ORBIT_WRITE_DATA'], validate=True)
fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
tmp = None
try:
    for part in parts[:-1]:
        try:
            os.mkdir(part, 0o700, dir_fd=fd)
        except FileExistsError:
            pass
        newfd = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
        os.close(fd)
        fd = newfd
    tmp = '.orbit-write-' + secrets.token_hex(16)
    out = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=fd)
    try:
        with os.fdopen(out, 'wb') as file:
            file.write(data)
        os.link(tmp, parts[-1], src_dir_fd=fd, dst_dir_fd=fd, follow_symlinks=False)
        os.unlink(tmp, dir_fd=fd)
        tmp = None
    finally:
        if tmp is not None:
            os.unlink(tmp, dir_fd=fd)
finally:
    os.close(fd)
`
