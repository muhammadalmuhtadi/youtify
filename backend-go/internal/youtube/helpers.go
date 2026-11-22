package youtube

import (
	"strconv"
	"strings"
)

func extractText(node any) string {
	switch v := node.(type) {
	case string:
		return v
	case map[string]any:
		if s, ok := v["content"].(string); ok {
			return s
		}
		if s, ok := v["simpleText"].(string); ok {
			return s
		}
		if runs, ok := v["runs"].([]any); ok {
			var b strings.Builder
			for _, item := range runs {
				if rm, ok := item.(map[string]any); ok {
					if txt, ok := rm["text"].(string); ok {
						b.WriteString(txt)
					}
				}
			}
			return b.String()
		}
	}
	return ""
}

func asMap(v any) map[string]any {
	if m, ok := v.(map[string]any); ok {
		return m
	}
	return nil
}

func asSlice(v any) []any {
	if s, ok := v.([]any); ok {
		return s
	}
	return nil
}

func asString(v any) string {
	switch val := v.(type) {
	case string:
		return val
	case float64:
		return strconv.FormatInt(int64(val), 10)
	case int:
		return strconv.Itoa(val)
	}
	return ""
}

func findContinuationToken(node any) string {
	var fallback string
	var walk func(cur any) string
	walk = func(cur any) string {
		switch v := cur.(type) {
		case []any:
			for _, item := range v {
				if tok := walk(item); tok != "" {
					return tok
				}
			}
		case map[string]any:
			if ep := asMap(v["continuationEndpoint"]); ep != nil {
				if tok := asString(asMap(ep["continuationCommand"])["token"]); tok != "" {
					return tok
				}
			}
			if ncd := asMap(v["nextContinuationData"]); ncd != nil && fallback == "" {
				fallback = asString(ncd["continuation"])
			}
			for _, child := range v {
				if tok := walk(child); tok != "" {
					return tok
				}
			}
		}
		return ""
	}
	if tok := walk(node); tok != "" {
		return tok
	}
	return fallback
}

func responseLooksLoggedOut(node any) bool {
	found := false
	var walk func(cur any)
	walk = func(cur any) {
		if found {
			return
		}
		switch v := cur.(type) {
		case []any:
			for _, item := range v {
				walk(item)
			}
		case map[string]any:
			if lr := asMap(v["loggedOutSectionRenderer"]); lr != nil {
				found = true
				return
			}
			for key, child := range v {
				if key == "buttonRenderer" {
					if m := asMap(child); m != nil {
						if ep := asMap(asMap(m["navigationEndpoint"])["signInEndpoint"]); ep != nil {
							found = true
							return
						}
					}
				}
				walk(child)
			}
		}
	}
	walk(node)
	return found
}
