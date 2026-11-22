//go:build js && wasm

package youtube

import (
	"net/http"
	"time"

	"github.com/syumai/workers-go/cloudflare/fetch"
)

func newHTTPClient(timeout time.Duration) *http.Client {
	c := fetch.NewClient().HTTPClient(fetch.RedirectModeFollow)
	c.Timeout = timeout
	return c
}
