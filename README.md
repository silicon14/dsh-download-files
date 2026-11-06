# dsh-download-files

Browser download for the files a turn delivers and for files open in the right
Sidebar's document preview.

The plugin adds one download action to each file surface of the Web GUI:

- **Delivery cards** — the card a finished turn shows for every file passed to
  the `present` tool.
- **Changed-file review tab** — the sidebar tab that compares a turn's changed
  file.
- **Right Sidebar document preview** — the header of an opened file, including
  files with no preview renderer.

Pressing the action asks the Host for the file with a download disposition and
hands the URL to the browser's own download manager, so the save dialog or the
browser's download folder receives the exact bytes, including large and binary
files. Nothing is assembled in the page and no native application is involved.

## Install

```sh
git clone https://github.com/silicon14/dsh-download-files.git "$HOME/dsh-plugins/dsh-download-files"
dsh plugin --profile web add "link:$HOME/dsh-plugins/dsh-download-files"
```

`link:` needs the expanded absolute path. Or run Plugin Manager's
`install_bundle` against the cloned directory. A reload of the open page picks
up the browser half; the Host route is live as soon as the row activates. The
plugin needs the Web composition's `ui-deliverables`,
`ui-sidebar-documentpreview`, `api-workspace-files`, and `workspace-changes`
rows, which the `dsh-web-app` bundle already supplies.

## Addresses

`GET|HEAD /api/file.download` accepts one of:

| Parameters | File |
|---|---|
| `sessionId`, `path` | The absolute path a document preview resolved. |
| `sessionId`, `seq`, `index`, `source=presented` | A file declared by that Session's delivery event. |
| `sessionId`, `seq`, `index`, `source=changes` | A file listed by that turn's change summary. |

The route is registered on the authenticated browser channel, so only the
page's own Peer reaches it. Downloads stream in 1 MiB windows; the filename and
media type travel in `Content-Disposition` and `Content-Type`.

## Limits

- The file must be readable through the composed Session filesystem. A deleted
  or non-regular file answers 404 and the action reports a retryable failure.
- The right Sidebar's file tree rows have no extension point, so the download
  action appears on an opened file's header rather than on each tree row.
