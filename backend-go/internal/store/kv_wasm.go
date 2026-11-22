//go:build js && wasm

package store

import "github.com/syumai/workers-go/cloudflare/kv"

type workersKV struct {
	ns *kv.Namespace
}

func NewWorkersKV(ns *kv.Namespace) SessionKV {
	if ns == nil {
		return nil
	}
	return &workersKV{ns: ns}
}

func (w *workersKV) GetString(key string) (string, error) {
	return w.ns.GetString(key, nil)
}

func (w *workersKV) PutString(key, value string) error {
	return w.ns.PutString(key, value, nil)
}

func (w *workersKV) Delete(key string) error {
	return w.ns.Delete(key)
}
