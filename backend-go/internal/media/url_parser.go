package media

import (
	"errors"
	"net/url"
	"regexp"
	"strings"
)

var (
	ytIDRegex        = regexp.MustCompile(`^[A-Za-z0-9_-]{11}$`)
	bareYTDomainRe   = regexp.MustCompile(`(?i)^(www\.)?(youtube\.com|youtu\.be|music\.youtube\.com|m\.youtube\.com)`)
	bareSCDomainRe   = regexp.MustCompile(`(?i)^(www\.|m\.)?soundcloud\.com`)
	schemePrefixRe   = regexp.MustCompile(`(?i)^https?://`)
	scInvalidSegment = map[string]bool{
		"discover": true,
		"stream":   true,
		"search":   true,
		"upload":   true,
		"charts":   true,
		"you":      true,
		"settings": true,
		"pages":    true,
	}
)

type ParsedMedia struct {
	SourceType   string
	YouTubeID    string
	CanonicalURL string
}

// ExtractYouTubeID extracts an 11-char YouTube video ID from standard watch, short, embed, live, or music URLs.
func ExtractYouTubeID(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return ""
	}
	if !schemePrefixRe.MatchString(trimmed) {
		if bareYTDomainRe.MatchString(trimmed) {
			trimmed = "https://" + trimmed
		} else {
			return ""
		}
	}

	u, err := url.Parse(trimmed)
	if err != nil {
		return ""
	}

	host := strings.ToLower(strings.TrimPrefix(u.Hostname(), "www."))
	var candidate string

	switch host {
	case "youtu.be":
		parts := splitNonEmpty(u.Path)
		if len(parts) > 0 {
			candidate = parts[0]
		}
	case "youtube.com", "m.youtube.com", "music.youtube.com", "youtube-nocookie.com":
		switch {
		case u.Path == "/watch":
			candidate = u.Query().Get("v")
		case strings.HasPrefix(u.Path, "/shorts/"):
			parts := splitNonEmpty(u.Path)
			if len(parts) >= 2 {
				candidate = parts[1]
			}
		case strings.HasPrefix(u.Path, "/live/"):
			parts := splitNonEmpty(u.Path)
			if len(parts) >= 2 {
				candidate = parts[1]
			}
		case strings.HasPrefix(u.Path, "/embed/"):
			parts := splitNonEmpty(u.Path)
			if len(parts) >= 2 {
				candidate = parts[1]
			}
		}
	}

	if ytIDRegex.MatchString(candidate) {
		return candidate
	}
	return ""
}

// IsSoundCloudURL reports whether the URL points to a SoundCloud track or set.
func IsSoundCloudURL(raw string) bool {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return false
	}
	if !schemePrefixRe.MatchString(trimmed) && bareSCDomainRe.MatchString(trimmed) {
		trimmed = "https://" + trimmed
	}
	u, err := url.Parse(trimmed)
	if err != nil {
		return false
	}
	host := strings.ToLower(u.Hostname())
	if host == "on.soundcloud.com" {
		return len(splitNonEmpty(u.Path)) >= 1
	}
	if host == "soundcloud.com" || host == "m.soundcloud.com" || host == "www.soundcloud.com" {
		parts := splitNonEmpty(u.Path)
		return len(parts) >= 2 && !scInvalidSegment[strings.ToLower(parts[0])]
	}
	return false
}

// ParseMediaURL normalizes YouTube, SoundCloud, or direct HTTP(S) audio URLs.
func ParseMediaURL(raw string) (ParsedMedia, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return ParsedMedia{}, errors.New("Media URL is required.")
	}

	if ytID := ExtractYouTubeID(trimmed); ytID != "" {
		return ParsedMedia{
			SourceType:   "youtube",
			YouTubeID:    ytID,
			CanonicalURL: "https://www.youtube.com/watch?v=" + ytID,
		}, nil
	}

	if IsSoundCloudURL(trimmed) {
		normalized := trimmed
		if !schemePrefixRe.MatchString(normalized) {
			normalized = "https://" + normalized
		}
		return ParsedMedia{
			SourceType:   "soundcloud",
			CanonicalURL: normalized,
		}, nil
	}

	u, err := url.Parse(trimmed)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return ParsedMedia{}, errors.New("Unsupported URL. Provide a valid YouTube, SoundCloud, or direct HTTP(S) audio link.")
	}

	return ParsedMedia{
		SourceType:   "audio",
		CanonicalURL: u.String(),
	}, nil
}

func splitNonEmpty(p string) []string {
	raw := strings.Split(p, "/")
	out := make([]string, 0, len(raw))
	for _, s := range raw {
		if s != "" {
			out = append(out, s)
		}
	}
	return out
}
