package media

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

const scBrowserUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"

var (
	scBundleRe   = regexp.MustCompile(`https://a-v2\.sndcdn\.com/assets/[^"]+\.js`)
	scClientIDRe = regexp.MustCompile(`client_id:"([a-zA-Z0-9]{20,40})"`)
	scBracketRe  = regexp.MustCompile(`\[[^\]]*\]`)
	scParenTagRe = regexp.MustCompile(`(?i)\([^)]*(official|video|lyrics|lyric|audio|4k|60fps|hd|soundtrack|music video|visualizer|mv)[^)]*\)`)
	scWordTagRe  = regexp.MustCompile(`(?i)\b(official soundtrack|official audio|official music video|official video|music video|lyric video|lyrics)\b`)
	scLabelRe    = regexp.MustCompile(`(?i)\b(musik|music|musikindo|records|record|studios|studio|production|entertainment|publishing|media|label|vevo|channel|official|lyrics|lirik|topic|tv|station)\b`)
	scFeatRe     = regexp.MustCompile(`(?i)\b(feat\.?|ft\.?)\b`)
	scDJRe       = regexp.MustCompile(`(?i)\bdj\b`)
	scNonAlnumRe = regexp.MustCompile(`[^a-z0-9\s]+`)
	scMultiSpRe  = regexp.MustCompile(`\s+`)

	scMu          sync.RWMutex
	scClientIDVal string
	scClientIDExp time.Time
	lastBufKey    string
	lastBufData   []byte
	lastBufMime   string
	lastBufExp    time.Time
)

func sendBytesWithRange(w http.ResponseWriter, data []byte, mimeType, rangeHeader string) {
	total := len(data)
	w.Header().Set("Content-Type", mimeType)
	w.Header().Set("Accept-Ranges", "bytes")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Younamp-Audio-Only", "true")

	if strings.HasPrefix(strings.TrimSpace(rangeHeader), "bytes=") {
		spec := strings.TrimPrefix(strings.TrimSpace(rangeHeader), "bytes=")
		parts := strings.SplitN(spec, "-", 2)
		if len(parts) == 2 {
			start := 0
			end := total - 1
			valid := true
			if parts[0] == "" && parts[1] != "" {
				suffix, err := strconv.Atoi(parts[1])
				if err != nil || suffix <= 0 {
					valid = false
				} else {
					start = total - suffix
					if start < 0 {
						start = 0
					}
				}
			} else {
				if parts[0] != "" {
					if v, err := strconv.Atoi(parts[0]); err != nil {
						valid = false
					} else {
						start = v
					}
				}
				if valid && parts[1] != "" {
					if v, err := strconv.Atoi(parts[1]); err != nil {
						valid = false
					} else if v < end {
						end = v
					}
				}
			}
			if valid && start >= 0 && start < total && start <= end {
				slice := data[start : end+1]
				w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, end, total))
				w.Header().Set("Content-Length", strconv.Itoa(len(slice)))
				w.WriteHeader(http.StatusPartialContent)
				_, _ = w.Write(slice)
				return
			}
		}
	}

	w.Header().Set("Content-Length", strconv.Itoa(total))
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}

func httpGetBytes(ctx context.Context, rawURL string, timeout time.Duration) (int, http.Header, []byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return 0, nil, nil, err
	}
	req.Header.Set("User-Agent", scBrowserUA)
	client := newHTTPClient(timeout)
	resp, err := client.Do(req)
	if err != nil {
		return 0, nil, nil, err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 4*1024*1024))
	return resp.StatusCode, resp.Header, data, err
}

func resolveYouTubeOEmbedTitle(ctx context.Context, youtubeID string) (string, string) {
	u := "https://www.youtube.com/oembed?url=" + url.QueryEscape("https://www.youtube.com/watch?v="+youtubeID) + "&format=json"
	code, _, body, err := httpGetBytes(ctx, u, 5*time.Second)
	if err != nil || code < 200 || code >= 300 {
		return "", ""
	}
	var res struct {
		Title      string `json:"title"`
		AuthorName string `json:"author_name"`
	}
	if json.Unmarshal(body, &res) != nil {
		return "", ""
	}
	return strings.TrimSpace(res.Title), strings.TrimSpace(res.AuthorName)
}

func getSoundCloudClientID(ctx context.Context, forceRefresh bool) (string, error) {
	if !forceRefresh {
		scMu.RLock()
		if scClientIDVal != "" && time.Now().Before(scClientIDExp) {
			val := scClientIDVal
			scMu.RUnlock()
			return val, nil
		}
		scMu.RUnlock()
	}

	code, _, body, err := httpGetBytes(ctx, "https://soundcloud.com", 7*time.Second)
	if err != nil || code < 200 || code >= 300 {
		return "", fmt.Errorf("soundcloud homepage failed (%d)", code)
	}
	matches := scBundleRe.FindAllString(string(body), -1)
	start := len(matches) - 4
	if start < 0 {
		start = 0
	}
	for i := len(matches) - 1; i >= start; i-- {
		bCode, _, jsBytes, bErr := httpGetBytes(ctx, matches[i], 7*time.Second)
		if bErr != nil || bCode < 200 || bCode >= 300 {
			continue
		}
		if m := scClientIDRe.FindSubmatch(jsBytes); len(m) > 1 {
			cid := string(m[1])
			scMu.Lock()
			scClientIDVal = cid
			scClientIDExp = time.Now().Add(6 * time.Hour)
			scMu.Unlock()
			return cid, nil
		}
	}
	return "", errors.New("could not resolve SoundCloud client_id")
}

func buildMirrorQueries(title, artist string) []string {
	clean := scBracketRe.ReplaceAllString(title, " ")
	clean = scParenTagRe.ReplaceAllString(clean, " ")
	clean = scWordTagRe.ReplaceAllString(clean, " ")
	clean = strings.ReplaceAll(clean, "|", " ")
	clean = strings.ReplaceAll(clean, "//", " ")
	clean = strings.TrimSpace(scMultiSpRe.ReplaceAllString(clean, " "))

	a := strings.TrimSpace(artist)
	lowerTitle := strings.ToLower(clean)
	lowerArtist := strings.ToLower(a)
	genericArtist := a == "" || lowerArtist == "youtube" || lowerArtist == "unknown artist" ||
		lowerArtist == "nocopyrightsounds" || lowerArtist == "album musik" ||
		lowerArtist == "gp records" || scLabelRe.MatchString(a)

	var queries []string
	if strings.Contains(clean, " - ") && clean != "" {
		queries = append(queries, clean)
	}
	if !genericArtist && clean != "" && !strings.Contains(lowerTitle, lowerArtist) {
		combo := strings.TrimSpace(a + " " + clean)
		found := false
		for _, q := range queries {
			if q == combo {
				found = true
				break
			}
		}
		if !found {
			queries = append(queries, combo)
		}
	}
	if clean != "" {
		found := false
		for _, q := range queries {
			if q == clean {
				found = true
				break
			}
		}
		if !found {
			queries = append(queries, clean)
		}
	}
	if len(queries) == 0 && strings.TrimSpace(title) != "" {
		queries = append(queries, strings.TrimSpace(title))
	}
	return queries
}

var variantPenaltyKeywords = []string{
	"cover", "covered by", "vocal cover", "remix", "koplo", "karaoke",
	"instrumental", "acoustic", "akustik", "live", "slowed", "reverb",
	"nightcore", "edit", "bootleg", "mashup", "parody", "ai cover",
	"rising star", "idol", "speed up", "sped up", "8d audio",
	"remastered", "extended",
}

func scoreSoundCloudCandidate(hitTitleRaw, hitDescRaw, hitUserRaw string, hitDurationMs int, reqTitleRaw string, targetDurationSec int) int {
	hitTitle := strings.ToLower(hitTitleRaw)
	hitDesc := strings.ToLower(hitDescRaw)
	hitUser := strings.ToLower(hitUserRaw)
	hitDurSec := (hitDurationMs + 500) / 1000
	reqTitle := strings.ToLower(reqTitleRaw)

	score := 0
	for _, kw := range variantPenaltyKeywords {
		if strings.Contains(hitTitle, kw) && !strings.Contains(reqTitle, kw) {
			score -= 130
		}
	}
	if scDJRe.MatchString(hitTitle) && !scDJRe.MatchString(reqTitle) {
		score -= 130
	}

	if (strings.Contains(hitDesc, "full video on youtube") ||
		strings.Contains(hitDesc, "cover") ||
		strings.Contains(hitDesc, "covered by") ||
		strings.Contains(hitDesc, "instagram :") ||
		strings.Contains(hitDesc, "tiktok :") ||
		strings.Contains(hitDesc, "youtube :")) && !strings.Contains(reqTitle, "cover") {
		score -= 120
	}

	if scFeatRe.MatchString(hitTitle) && !scFeatRe.MatchString(reqTitle) {
		score -= 80
	}

	cleanedReq := scBracketRe.ReplaceAllString(reqTitle, " ")
	cleanedReq = strings.ReplaceAll(cleanedReq, "(", " ")
	cleanedReq = strings.ReplaceAll(cleanedReq, ")", " ")
	cleanedReq = scNonAlnumRe.ReplaceAllString(cleanedReq, " ")
	words := strings.Fields(cleanedReq)
	var reqTokens []string
	for _, w := range words {
		if len(w) < 2 {
			continue
		}
		switch w {
		case "official", "music", "video", "audio", "lyrics", "lyric", "mv", "hd":
			continue
		}
		reqTokens = append(reqTokens, w)
	}
	if len(reqTokens) > 0 {
		matched := 0
		for _, tok := range reqTokens {
			if strings.Contains(hitTitle, tok) || strings.Contains(hitUser, tok) {
				matched++
			}
		}
		score += (matched * 60) / len(reqTokens)
	}

	if targetDurationSec > 0 && hitDurSec > 0 {
		diff := hitDurSec - targetDurationSec
		if diff < 0 {
			diff = -diff
		}
		switch {
		case diff <= 15:
			score += 45 - diff
		case diff <= 30:
			score += 20
		case diff <= 45:
			score += 5
		case diff > 60:
			score -= 100
		}
	}

	return score
}

type scTranscoding struct {
	URL    string `json:"url"`
	Preset string `json:"preset"`
	Format struct {
		Protocol string `json:"protocol"`
		MimeType string `json:"mime_type"`
	} `json:"format"`
}

func resolveSoundCloudStream(ctx context.Context, queries []string, reqTitle string, targetDurationSec int) (string, string, bool, error) {
	clientID, err := getSoundCloudClientID(ctx, false)
	if err != nil {
		return "", "", false, err
	}

	for _, q := range queries {
		searchURL := "https://api-v2.soundcloud.com/search/tracks?q=" + url.QueryEscape(q) + "&client_id=" + url.QueryEscape(clientID) + "&limit=15"
		code, _, body, sErr := httpGetBytes(ctx, searchURL, 6*time.Second)
		if code == 401 || code == 403 {
			if refreshed, rErr := getSoundCloudClientID(ctx, true); rErr == nil {
				clientID = refreshed
				searchURL = "https://api-v2.soundcloud.com/search/tracks?q=" + url.QueryEscape(q) + "&client_id=" + url.QueryEscape(clientID) + "&limit=15"
				code, _, body, sErr = httpGetBytes(ctx, searchURL, 6*time.Second)
			}
		}
		if sErr != nil || code < 200 || code >= 300 {
			continue
		}

		type scHit struct {
			Title              string `json:"title"`
			Description        string `json:"description"`
			Duration           int    `json:"duration"`
			TrackAuthorization string `json:"track_authorization"`
			User               struct {
				Username string `json:"username"`
			} `json:"user"`
			Media struct {
				Transcodings []scTranscoding `json:"transcodings"`
			} `json:"media"`
		}
		var payload struct {
			Collection []scHit `json:"collection"`
		}
		if json.Unmarshal(body, &payload) != nil {
			continue
		}

		type rankedHit struct {
			hit   scHit
			score int
		}
		ranked := make([]rankedHit, 0, len(payload.Collection))
		for _, hit := range payload.Collection {
			ranked = append(ranked, rankedHit{
				hit:   hit,
				score: scoreSoundCloudCandidate(hit.Title, hit.Description, hit.User.Username, hit.Duration, reqTitle, targetDurationSec),
			})
		}
		sort.SliceStable(ranked, func(i, j int) bool {
			return ranked[i].score > ranked[j].score
		})

		for _, rh := range ranked {
			hit := rh.hit
			if hit.TrackAuthorization == "" || len(hit.Media.Transcodings) == 0 {
				continue
			}
			var valid []scTranscoding
			for _, tc := range hit.Media.Transcodings {
				if tc.URL == "" {
					continue
				}
				if strings.Contains(tc.Format.MimeType, "mpegurl") && tc.Format.Protocol == "hls" {
					continue
				}
				valid = append(valid, tc)
			}
			var ordered []scTranscoding
			for _, tc := range valid {
				if tc.Format.Protocol == "progressive" && strings.Contains(tc.Format.MimeType, "mpeg") {
					ordered = append(ordered, tc)
				}
			}
			for _, tc := range valid {
				if tc.Preset == "aac_160k" {
					ordered = append(ordered, tc)
				}
			}
			for _, tc := range valid {
				if strings.Contains(tc.Format.MimeType, "mp4") {
					ordered = append(ordered, tc)
				}
			}
			ordered = append(ordered, valid...)

			seen := make(map[string]bool)
			for _, tc := range ordered {
				if tc.URL == "" || seen[tc.URL] {
					continue
				}
				seen[tc.URL] = true
				sep := "?"
				if strings.Contains(tc.URL, "?") {
					sep = "&"
				}
				trURL := tc.URL + sep + "client_id=" + url.QueryEscape(clientID) + "&track_authorization=" + url.QueryEscape(hit.TrackAuthorization)
				trCode, _, trBody, trErr := httpGetBytes(ctx, trURL, 5*time.Second)
				if trErr != nil || trCode < 200 || trCode >= 300 {
					continue
				}
				var trRes struct {
					URL string `json:"url"`
				}
				if json.Unmarshal(trBody, &trRes) == nil && trRes.URL != "" {
					mimeType := "audio/mp4"
					if strings.Contains(tc.Format.MimeType, "mpeg") && !strings.Contains(tc.Format.MimeType, "mpegurl") {
						mimeType = "audio/mpeg"
					}
					return trRes.URL, mimeType, tc.Format.Protocol == "progressive", nil
				}
			}
		}
	}
	return "", "", false, errors.New("no playable mirror found")
}

func parseHLSURLs(manifestURL, body string) []string {
	base, err := url.Parse(manifestURL)
	lines := strings.Split(body, "\n")
	urls := make([]string, 0, len(lines))
	resolveRef := func(raw string) string {
		raw = strings.TrimSpace(raw)
		if raw == "" {
			return ""
		}
		if err != nil {
			return raw
		}
		if parsed, pErr := base.Parse(raw); pErr == nil {
			return parsed.String()
		}
		return raw
	}

	for _, line := range lines {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "#EXT-X-MAP:URI=") {
			parts := strings.Split(line, `"`)
			if len(parts) >= 2 {
				if u := resolveRef(parts[1]); u != "" {
					urls = append([]string{u}, urls...)
				}
			}
			continue
		}
		if line != "" && !strings.HasPrefix(line, "#") {
			if u := resolveRef(line); u != "" {
				urls = append(urls, u)
			}
		}
	}
	return urls
}

// StreamYouTubeAudioMirror streams audio bytes for a YouTube track using SoundCloud's HTTP v2 API.
func StreamYouTubeAudioMirror(ctx context.Context, w http.ResponseWriter, rangeHeader, youtubeID, title, artist string, targetDurationSec int) (retErr error) {
	defer func() {
		if r := recover(); r != nil {
			retErr = fmt.Errorf("audio mirror panic: %v", r)
		}
	}()

	scMu.RLock()
	if lastBufKey == youtubeID && len(lastBufData) > 0 && time.Now().Before(lastBufExp) {
		cached := lastBufData
		cachedMime := lastBufMime
		scMu.RUnlock()
		sendBytesWithRange(w, cached, cachedMime, rangeHeader)
		return nil
	}
	scMu.RUnlock()

	cleanTitle := strings.TrimSpace(title)
	cleanArtist := strings.TrimSpace(artist)
	if cleanTitle == "" || strings.HasPrefix(cleanTitle, "YouTube Audio (") {
		oTitle, oAuthor := resolveYouTubeOEmbedTitle(ctx, youtubeID)
		if oTitle != "" {
			cleanTitle = oTitle
		}
		if cleanArtist == "" && oAuthor != "" {
			cleanArtist = oAuthor
		}
	}
	if cleanTitle == "" {
		return errors.New("track title required for audio mirror")
	}

	queries := buildMirrorQueries(cleanTitle, cleanArtist)
	streamURL, mimeType, isProgressive, err := resolveSoundCloudStream(ctx, queries, cleanTitle, targetDurationSec)
	if err != nil {
		return err
	}

	if isProgressive {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, streamURL, nil)
		if err != nil {
			return err
		}
		req.Header.Set("User-Agent", scBrowserUA)
		if rangeHeader != "" {
			req.Header.Set("Range", rangeHeader)
		}
		client := newHTTPClient(25 * time.Second)
		resp, err := client.Do(req)
		if err != nil {
			return err
		}
		defer resp.Body.Close()
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			return fmt.Errorf("progressive stream error (%d)", resp.StatusCode)
		}
		for _, h := range []string{"Content-Type", "Content-Length", "Content-Range", "Accept-Ranges"} {
			if val := resp.Header.Get(h); val != "" {
				w.Header().Set(h, val)
			}
		}
		if w.Header().Get("Content-Type") == "" {
			w.Header().Set("Content-Type", mimeType)
		}
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Younamp-Audio-Only", "true")
		w.WriteHeader(resp.StatusCode)
		_, _ = io.Copy(w, resp.Body)
		return nil
	}

	mCode, _, mBody, mErr := httpGetBytes(ctx, streamURL, 8*time.Second)
	if mErr != nil || mCode < 200 || mCode >= 300 {
		return fmt.Errorf("manifest fetch failed (%d)", mCode)
	}
	segURLs := parseHLSURLs(streamURL, string(mBody))
	if len(segURLs) == 0 {
		return errors.New("empty audio manifest")
	}
	// Keep total subrequests safely under Cloudflare Workers 50-subrequest limit.
	if len(segURLs) > 28 {
		segURLs = segURLs[:28]
	}

	bufs := make([][]byte, len(segURLs))
	var cursor int32
	var failed int32
	workers := 4
	if len(segURLs) < workers {
		workers = len(segURLs)
	}
	var wg sync.WaitGroup
	for wIdx := 0; wIdx < workers; wIdx++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for {
				idx := int(atomic.AddInt32(&cursor, 1) - 1)
				if idx >= len(segURLs) || atomic.LoadInt32(&failed) != 0 {
					return
				}
				code, _, data, gErr := httpGetBytes(ctx, segURLs[idx], 10*time.Second)
				if gErr != nil || code < 200 || code >= 300 || len(data) == 0 {
					if idx == 0 {
						atomic.StoreInt32(&failed, 1)
					}
					return
				}
				bufs[idx] = data
			}
		}()
	}
	wg.Wait()
	if atomic.LoadInt32(&failed) != 0 || len(bufs[0]) == 0 {
		return errors.New("failed to assemble mirror segments")
	}

	var out bytes.Buffer
	for _, b := range bufs {
		if len(b) > 0 {
			_, _ = out.Write(b)
		}
	}
	assembled := out.Bytes()
	if len(assembled) == 0 {
		return errors.New("empty audio buffer")
	}
	if len(assembled) <= 12*1024*1024 {
		scMu.Lock()
		lastBufKey = youtubeID
		lastBufData = assembled
		lastBufMime = mimeType
		lastBufExp = time.Now().Add(15 * time.Minute)
		scMu.Unlock()
	}
	sendBytesWithRange(w, assembled, mimeType, rangeHeader)
	return nil
}
