package youtube

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
)

var (
	videoIDPattern      = regexp.MustCompile(`^[a-zA-Z0-9_-]{11}$`)
	durationPartPattern = regexp.MustCompile(`^\d+(:\d{1,2})+$`)
)

type SearchResult struct {
	YoutubeID    string `json:"youtube_id"`
	Title        string `json:"title"`
	Artist       string `json:"artist"`
	Duration     int    `json:"duration"`
	DurationText string `json:"duration_text"`
	Views        string `json:"views"`
	PublishedAt  string `json:"published_at"`
	ThumbnailURL string `json:"thumbnail_url"`
	URL          string `json:"url"`
	SourceType   string `json:"source_type"`
}

// ParseDurationToSeconds parses strings such as "3:58", "3.58", or "1:02:15" into seconds.
func ParseDurationToSeconds(text string) int {
	clean := strings.ReplaceAll(strings.TrimSpace(text), ".", ":")
	if !durationPartPattern.MatchString(clean) {
		return 0
	}
	parts := strings.Split(clean, ":")
	total := 0
	for _, p := range parts {
		n, err := strconv.Atoi(p)
		if err != nil {
			return 0
		}
		total = total*60 + n
	}
	return total
}

func normalizeVideoRenderer(vr map[string]any) *SearchResult {
	if vr == nil {
		return nil
	}
	videoID := strings.TrimSpace(asString(vr["videoId"]))
	if !videoIDPattern.MatchString(videoID) {
		return nil
	}
	title := strings.TrimSpace(extractText(vr["title"]))
	if title == "" {
		return nil
	}
	artist := strings.TrimSpace(extractText(vr["ownerText"]))
	if artist == "" {
		artist = strings.TrimSpace(extractText(vr["longBylineText"]))
	}
	if artist == "" {
		artist = "YouTube"
	}

	rawDur := strings.TrimSpace(extractText(vr["lengthText"]))
	dur := ParseDurationToSeconds(rawDur)
	durText := "LIVE"
	if rawDur != "" {
		durText = strings.ReplaceAll(rawDur, ".", ":")
	}

	views := strings.TrimSpace(extractText(vr["shortViewCountText"]))
	if views == "" {
		views = strings.TrimSpace(extractText(vr["viewCountText"]))
	}

	return &SearchResult{
		YoutubeID:    videoID,
		Title:        title,
		Artist:       artist,
		Duration:     dur,
		DurationText: durText,
		Views:        views,
		PublishedAt:  strings.TrimSpace(extractText(vr["publishedTimeText"])),
		ThumbnailURL: fmt.Sprintf("https://i.ytimg.com/vi/%s/hqdefault.jpg", videoID),
		URL:          fmt.Sprintf("https://www.youtube.com/watch?v=%s", videoID),
		SourceType:   "youtube",
	}
}

// CollectSearchRenderers extracts up to 20 unique search results from a YouTube search payload.
func CollectSearchRenderers(data map[string]any) []SearchResult {
	contents := asMap(data["contents"])
	twoCol := asMap(contents["twoColumnSearchResultsRenderer"])
	primary := asMap(twoCol["primaryContents"])
	secList := asMap(primary["sectionListRenderer"])
	sections := asSlice(secList["contents"])

	results := make([]SearchResult, 0, 20)
	seen := make(map[string]bool)

	push := func(vr map[string]any) {
		item := normalizeVideoRenderer(vr)
		if item == nil || seen[item.YoutubeID] {
			return
		}
		seen[item.YoutubeID] = true
		results = append(results, *item)
	}

	for _, secAny := range sections {
		sec := asMap(secAny)
		isr := asMap(sec["itemSectionRenderer"])
		for _, entryAny := range asSlice(isr["contents"]) {
			entry := asMap(entryAny)
			if vr := asMap(entry["videoRenderer"]); vr != nil {
				push(vr)
			} else if sr := asMap(entry["shelfRenderer"]); sr != nil {
				vert := asMap(asMap(sr["content"])["verticalListRenderer"])
				for _, subAny := range asSlice(vert["items"]) {
					if sub := asMap(subAny); sub != nil {
						push(asMap(sub["videoRenderer"]))
					}
				}
			}
			if len(results) >= 20 {
				return results
			}
		}
	}
	return results
}

func SearchInnerTube(ctx context.Context, rawQuery, filter string) ([]SearchResult, error) {
	q := strings.TrimSpace(rawQuery)
	if q == "" {
		return []SearchResult{}, nil
	}

	effectiveQuery := q
	switch filter {
	case "music":
		effectiveQuery = q + " official audio"
	case "podcast":
		effectiveQuery = q + " podcast"
	}

	payload := map[string]any{
		"context": map[string]any{
			"client": map[string]any{
				"clientName":    "WEB",
				"clientVersion": "2.20250214.01.00",
				"hl":            "id",
				"gl":            "ID",
			},
		},
		"query": effectiveQuery,
	}
	bodyBytes, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, ytOrigin+"/youtubei/v1/search?prettyPrint=false", bytes.NewReader(bodyBytes))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", userAgent)

	client := newHTTPClient(9 * time.Second)
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("YouTube search request failed (status %d).", resp.StatusCode)
	}

	var data map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return nil, err
	}
	return CollectSearchRenderers(data), nil
}

func FetchSuggestions(ctx context.Context, rawQuery string) ([]string, error) {
	q := strings.TrimSpace(rawQuery)
	if len(q) < 2 {
		return []string{}, nil
	}

	endpoint := "https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&q=" + url.QueryEscape(q)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return []string{}, nil
	}
	req.Header.Set("User-Agent", userAgent)

	client := newHTTPClient(4 * time.Second)
	resp, err := client.Do(req)
	if err != nil {
		return []string{}, nil
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return []string{}, nil
	}

	var raw []any
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil || len(raw) < 2 {
		return []string{}, nil
	}
	items := asSlice(raw[1])
	out := make([]string, 0, 6)
	for _, it := range items {
		if s, ok := it.(string); ok && s != "" {
			out = append(out, s)
			if len(out) >= 6 {
				break
			}
		}
	}
	return out, nil
}
