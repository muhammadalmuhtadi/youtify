package youtube

import (
	"bytes"
	"context"
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const (
	ytOrigin         = "https://www.youtube.com"
	innertubeVersion = "2.20261119.07.00"
	userAgent        = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)

var (
	requiredAuthCookies = []string{
		"SAPISID", "__Secure-3PAPISID", "__Secure-1PAPISID",
		"SID", "__Secure-3PSID", "__Secure-1PSID",
	}
	playlistDomainRe = regexp.MustCompile(`(?i)youtube\.com|google\.com`)
	playlistIDRe     = regexp.MustCompile(`(?i)^(PL|OLAK5uy_|UU|FL|WL|LL|LM)`)
	publicImportIDRe = regexp.MustCompile(`^(PL|OLAK5uy_|UU|FL|RD)[A-Za-z0-9_-]{8,}$`)
	listParamRe      = regexp.MustCompile(`[?&]list=([A-Za-z0-9_-]+)`)
	digitsOnlyRe     = regexp.MustCompile(`\d[\d,.]*`)
	nonDigitsRe      = regexp.MustCompile(`[^\d]`)
)

type CookieEntry struct {
	Name           string  `json:"name"`
	Value          string  `json:"value"`
	Domain         string  `json:"domain,omitempty"`
	Path           string  `json:"path,omitempty"`
	Secure         bool    `json:"secure,omitempty"`
	HTTPOnly       bool    `json:"httpOnly,omitempty"`
	ExpirationDate float64 `json:"expirationDate,omitempty"`
}

type YtContext struct {
	LoggedIn           bool   `json:"loggedIn"`
	SessionIndex       string `json:"sessionIndex"`
	DelegatedSessionID string `json:"delegatedSessionId"`
	DatasyncID         string `json:"datasyncId"`
	VisitorData        string `json:"visitorData"`
	ClientVersion      string `json:"clientVersion"`
}

type CookieSession struct {
	UpdatedAt    string            `json:"updatedAt"`
	CookieCount  int               `json:"cookieCount"`
	CookieHeader string            `json:"cookieHeader"`
	CookieMap    map[string]string `json:"cookieMap"`
	YtContext    YtContext         `json:"ytContext"`
}

type AccountIdentity struct {
	Name      string `json:"name"`
	Handle    string `json:"handle"`
	Email     string `json:"email"`
	AvatarURL string `json:"avatar_url"`
}

type RemoteTrack struct {
	YoutubeID    string `json:"youtube_id"`
	YtSetVideoID string `json:"yt_set_video_id"`
	Title        string `json:"title"`
	Artist       string `json:"artist"`
	Duration     int    `json:"duration"`
	ThumbnailURL string `json:"thumbnail_url"`
	URL          string `json:"url"`
	SourceType   string `json:"source_type"`
}

type RemotePlaylist struct {
	YoutubePlaylistID string        `json:"youtube_playlist_id"`
	Name              string        `json:"name"`
	Description       string        `json:"description"`
	CoverImage        string        `json:"cover_image"`
	VideoCount        int           `json:"video_count"`
	YtEditable        bool          `json:"yt_editable"`
	Tracks            []RemoteTrack `json:"tracks,omitempty"`
}

func sha1Hex(val string) string {
	sum := sha1.Sum([]byte(val))
	return hex.EncodeToString(sum[:])
}

// ParseCookieInput parses JSON cookie arrays, Netscape cookies.txt, or raw Cookie header strings.
func ParseCookieInput(cookies []CookieEntry, cookieInput string) (*CookieSession, error) {
	var rawEntries []CookieEntry
	if len(cookies) > 0 {
		rawEntries = cookies
	} else {
		trimmed := strings.TrimSpace(cookieInput)
		if trimmed == "" {
			return nil, errors.New("Please provide your YouTube session cookies (Cookie header or cookies.txt).")
		}
		if strings.HasPrefix(trimmed, "[") || strings.HasPrefix(trimmed, "{") {
			var arr []CookieEntry
			if err := json.Unmarshal([]byte(trimmed), &arr); err == nil && len(arr) > 0 {
				rawEntries = arr
			} else {
				var wrapper struct {
					Cookies []CookieEntry `json:"cookies"`
				}
				if err := json.Unmarshal([]byte(trimmed), &wrapper); err == nil && len(wrapper.Cookies) > 0 {
					rawEntries = wrapper.Cookies
				}
			}
		}
		if len(rawEntries) == 0 {
			lines := strings.Split(strings.ReplaceAll(trimmed, "\r\n", "\n"), "\n")
			looksNetscape := strings.Contains(trimmed, "# Netscape HTTP Cookie File")
			if !looksNetscape {
				for _, l := range lines {
					if len(strings.Split(l, "\t")) >= 7 {
						looksNetscape = true
						break
					}
				}
			}
			if looksNetscape {
				for _, line := range lines {
					line = strings.TrimSpace(line)
					if line == "" {
						continue
					}
					if strings.HasPrefix(line, "#HttpOnly_") {
						line = strings.TrimPrefix(line, "#HttpOnly_")
					} else if strings.HasPrefix(line, "#") {
						continue
					}
					parts := strings.Split(line, "\t")
					if len(parts) < 7 {
						continue
					}
					domain, cookiePath, secureStr, name := strings.TrimSpace(parts[0]), strings.TrimSpace(parts[2]), strings.TrimSpace(parts[3]), strings.TrimSpace(parts[5])
					val := strings.TrimSpace(strings.Join(parts[6:], "\t"))
					if name == "" || val == "" {
						continue
					}
					if domain != "" && !playlistDomainRe.MatchString(domain) {
						continue
					}
					rawEntries = append(rawEntries, CookieEntry{
						Name:   name,
						Value:  val,
						Domain: domain,
						Path:   cookiePath,
						Secure: strings.EqualFold(secureStr, "TRUE"),
					})
				}
			} else {
				headerBody := trimmed
				if len(headerBody) >= 7 && strings.EqualFold(headerBody[:7], "cookie:") {
					headerBody = strings.TrimSpace(headerBody[7:])
				} else if idx := strings.Index(strings.ToLower(headerBody), "cookie:"); idx == 0 {
					headerBody = strings.TrimSpace(headerBody[len("cookie:"):])
				}
				for _, pair := range strings.Split(headerBody, ";") {
					eq := strings.IndexByte(pair, '=')
					if eq <= 0 {
						continue
					}
					name := strings.TrimSpace(pair[:eq])
					val := strings.TrimSpace(pair[eq+1:])
					if name == "" || val == "" {
						continue
					}
					rawEntries = append(rawEntries, CookieEntry{Name: name, Value: val, Domain: ".youtube.com", Path: "/"})
				}
			}
		}
	}

	cookieMap := make(map[string]string)
	order := make([]string, 0, len(rawEntries))
	for _, item := range rawEntries {
		name := strings.TrimSpace(item.Name)
		val := item.Value
		if name == "" || val == "" {
			continue
		}
		if _, exists := cookieMap[name]; !exists {
			order = append(order, name)
		}
		cookieMap[name] = val
	}

	hasAuth := false
	for _, reqName := range requiredAuthCookies {
		if cookieMap[reqName] != "" {
			hasAuth = true
			break
		}
	}
	if !hasAuth {
		return nil, errors.New("No signed-in YouTube auth cookies found (SAPISID or SID missing). Sign in on youtube.com first.")
	}

	headerParts := make([]string, 0, len(order))
	for _, name := range order {
		headerParts = append(headerParts, name+"="+cookieMap[name])
	}

	return &CookieSession{
		UpdatedAt:    time.Now().UTC().Format(time.RFC3339),
		CookieCount:  len(order),
		CookieHeader: strings.Join(headerParts, "; "),
		CookieMap:    cookieMap,
	}, nil
}

// ExtractJSONAssignment scans balanced braces after marker (e.g., "var ytInitialData =" or "ytcfg.set(").
func ExtractJSONAssignment(html, marker string) map[string]any {
	if html == "" || marker == "" {
		return nil
	}
	idx := strings.Index(html, marker)
	if idx == -1 {
		return nil
	}
	relStart := strings.IndexByte(html[idx+len(marker):], '{')
	if relStart == -1 {
		return nil
	}
	start := idx + len(marker) + relStart
	depth := 0
	inString := false
	escaped := false

	for i := start; i < len(html); i++ {
		ch := html[i]
		if inString {
			if escaped {
				escaped = false
			} else if ch == '\\' {
				escaped = true
			} else if ch == '"' {
				inString = false
			}
		} else {
			switch ch {
			case '"':
				inString = true
			case '{':
				depth++
			case '}':
				depth--
				if depth == 0 {
					var out map[string]any
					if err := json.Unmarshal([]byte(html[start:i+1]), &out); err != nil {
						return nil
					}
					return out
				}
			}
		}
	}
	return nil
}

// ExtractYtCfgFromHTML extracts InnerTube session context (SESSION_INDEX, DELEGATED_SESSION_ID, DATASYNC_ID, VISITOR_DATA, LOGGED_IN).
func ExtractYtCfgFromHTML(html string) YtContext {
	cfg := ExtractJSONAssignment(html, "ytcfg.set(")
	pickStr := func(key string) string {
		if cfg != nil {
			if s := asString(cfg[key]); s != "" {
				return s
			}
		}
		re := regexp.MustCompile(fmt.Sprintf(`"%s"\s*:\s*"([^"]*)"`, regexp.QuoteMeta(key)))
		if m := re.FindStringSubmatch(html); len(m) >= 2 {
			return m[1]
		}
		return ""
	}

	loggedIn := false
	if cfg != nil {
		if b, ok := cfg["LOGGED_IN"].(bool); ok {
			loggedIn = b
		}
	}
	if !loggedIn {
		if m := regexp.MustCompile(`"LOGGED_IN"\s*:\s*(true|false)`).FindStringSubmatch(html); len(m) >= 2 {
			loggedIn = m[1] == "true"
		}
	}

	sessionIndex := ""
	if cfg != nil && cfg["SESSION_INDEX"] != nil {
		sessionIndex = asString(cfg["SESSION_INDEX"])
	}
	if sessionIndex == "" {
		if m := regexp.MustCompile(`"SESSION_INDEX"\s*:\s*"?(\d+)"?`).FindStringSubmatch(html); len(m) >= 2 {
			sessionIndex = m[1]
		}
	}
	if sessionIndex == "" {
		sessionIndex = "0"
	}

	clientVer := pickStr("INNERTUBE_CLIENT_VERSION")
	if clientVer == "" {
		clientVer = innertubeVersion
	}

	return YtContext{
		LoggedIn:           loggedIn,
		SessionIndex:       sessionIndex,
		DelegatedSessionID: pickStr("DELEGATED_SESSION_ID"),
		DatasyncID:         pickStr("DATASYNC_ID"),
		VisitorData:        pickStr("VISITOR_DATA"),
		ClientVersion:      clientVer,
	}
}

// BuildSapisidAuthorization computes YouTube SAPISIDHASH / SAPISID3PHASH / SAPISID1PHASH header value.
func BuildSapisidAuthorization(cookieMap map[string]string, datasyncID string, useDatasync bool) string {
	sapisid := cookieMap["SAPISID"]
	if sapisid == "" {
		sapisid = cookieMap["__Secure-3PAPISID"]
	}
	sapisid1p := cookieMap["__Secure-1PAPISID"]
	sapisid3p := cookieMap["__Secure-3PAPISID"]
	if sapisid == "" && sapisid1p == "" && sapisid3p == "" {
		return ""
	}

	ts := strconv.FormatInt(time.Now().Unix(), 10)
	parts := strings.Split(strings.TrimSpace(datasyncID), "||")
	dsPrimary := strings.TrimSpace(parts[0])
	validDatasync := useDatasync && dsPrimary != "" && !strings.HasPrefix(dsPrimary, "V")

	computeScheme := func(scheme, secret string) string {
		if secret == "" {
			return ""
		}
		if validDatasync {
			input := fmt.Sprintf("%s %s %s %s", dsPrimary, ts, secret, ytOrigin)
			return fmt.Sprintf("%s %s_%s_u", scheme, ts, sha1Hex(input))
		}
		input := fmt.Sprintf("%s %s %s", ts, secret, ytOrigin)
		return fmt.Sprintf("%s %s_%s", scheme, ts, sha1Hex(input))
	}

	tokens := make([]string, 0, 3)
	if t := computeScheme("SAPISIDHASH", sapisid); t != "" {
		tokens = append(tokens, t)
	}
	if t := computeScheme("SAPISID1PHASH", sapisid1p); t != "" {
		tokens = append(tokens, t)
	}
	if t := computeScheme("SAPISID3PHASH", sapisid3p); t != "" {
		tokens = append(tokens, t)
	}
	return strings.Join(tokens, " ")
}

func doInnerTubeRequest(ctx context.Context, endpoint string, body map[string]any, session *CookieSession, refererPath string, useDatasync bool) (int, map[string]any, error) {
	var ytCtx YtContext
	if session != nil {
		ytCtx = session.YtContext
	}
	clientVer := ytCtx.ClientVersion
	if clientVer == "" {
		clientVer = innertubeVersion
	}

	clientObj := map[string]any{
		"clientName":    "WEB",
		"clientVersion": clientVer,
		"hl":            "en",
		"gl":            "US",
	}
	if ytCtx.VisitorData != "" {
		clientObj["visitorData"] = ytCtx.VisitorData
	}

	reqBody := make(map[string]any, len(body)+1)
	for k, v := range body {
		reqBody[k] = v
	}
	reqBody["context"] = map[string]any{"client": clientObj}

	rawBytes, err := json.Marshal(reqBody)
	if err != nil {
		return 0, nil, err
	}

	sep := "?"
	if strings.Contains(endpoint, "?") {
		sep = "&"
	}
	fullURL := ytOrigin + endpoint + sep + "prettyPrint=false"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, fullURL, bytes.NewReader(rawBytes))
	if err != nil {
		return 0, nil, err
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", ytOrigin)
	req.Header.Set("Referer", ytOrigin+refererPath)
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("X-YouTube-Client-Name", "1")
	req.Header.Set("X-YouTube-Client-Version", clientVer)
	if ytCtx.VisitorData != "" {
		req.Header.Set("X-Goog-Visitor-Id", ytCtx.VisitorData)
	}

	if session != nil && session.CookieHeader != "" {
		req.Header.Set("Cookie", session.CookieHeader)
		if session.CookieMap != nil {
			if auth := BuildSapisidAuthorization(session.CookieMap, ytCtx.DatasyncID, useDatasync); auth != "" {
				req.Header.Set("Authorization", auth)
				authUser := ytCtx.SessionIndex
				if authUser == "" {
					authUser = "0"
				}
				req.Header.Set("X-Goog-AuthUser", authUser)
				if ytCtx.DelegatedSessionID != "" {
					req.Header.Set("X-Goog-PageId", ytCtx.DelegatedSessionID)
				}
			}
		}
	}

	client := newHTTPClient(15 * time.Second)
	resp, err := client.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer resp.Body.Close()

	respBytes, _ := io.ReadAll(resp.Body)
	var data map[string]any
	_ = json.Unmarshal(respBytes, &data)
	return resp.StatusCode, data, nil
}

func InnerTubePost(ctx context.Context, endpoint string, body map[string]any, session *CookieSession, refererPath string) (map[string]any, error) {
	if refererPath == "" {
		refererPath = "/feed/playlists"
	}
	hasDs := session != nil && session.YtContext.DatasyncID != "" && !strings.HasPrefix(session.YtContext.DatasyncID, "V")
	status, data, err := doInnerTubeRequest(ctx, endpoint, body, session, refererPath, hasDs)
	if err != nil {
		return nil, err
	}
	if (status == http.StatusUnauthorized || status == http.StatusForbidden) && session != nil && hasDs {
		status, data, err = doInnerTubeRequest(ctx, endpoint, body, session, refererPath, false)
		if err != nil {
			return nil, err
		}
	}
	if status < 200 || status >= 300 {
		errMsg := asString(asMap(data["error"])["message"])
		if errMsg == "" {
			errMsg = fmt.Sprintf("YouTube InnerTube request %s failed (%d)", endpoint, status)
		}
		return nil, errors.New(errMsg)
	}
	return data, nil
}

// FetchLiveYouTubeFeedContext fetches /feed/playlists with explicit Cookie header to resolve authenticated ytcfg + ytInitialData.
func FetchLiveYouTubeFeedContext(ctx context.Context, session *CookieSession) (*YtContext, map[string]any, error) {
	if session == nil || session.CookieHeader == "" {
		return nil, nil, nil
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, ytOrigin+"/feed/playlists", nil)
	if err != nil {
		return nil, nil, err
	}
	req.Header.Set("Cookie", session.CookieHeader)
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Accept-Language", "en-US,en;q=0.9")

	client := newHTTPClient(15 * time.Second)
	resp, err := client.Do(req)
	if err != nil || resp.StatusCode < 200 || resp.StatusCode >= 300 {
		if resp != nil {
			resp.Body.Close()
		}
		return nil, nil, err
	}
	defer resp.Body.Close()

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, nil, err
	}
	html := string(bodyBytes)
	ytCtx := ExtractYtCfgFromHTML(html)
	initData := ExtractJSONAssignment(html, "var ytInitialData =")
	return &ytCtx, initData, nil
}

// ParseAccountIdentityFromMenu extracts channel name, handle, email, and avatar URL from account_menu or topbar data.
func ParseAccountIdentityFromMenu(data map[string]any) AccountIdentity {
	var header map[string]any
	var avatarFallback string

	var walk func(cur any)
	walk = func(cur any) {
		switch v := cur.(type) {
		case []any:
			for _, item := range v {
				walk(item)
			}
		case map[string]any:
			if ahr := asMap(v["activeAccountHeaderRenderer"]); ahr != nil && header == nil {
				header = ahr
				return
			}
			if tmb := asMap(v["topbarMenuButtonRenderer"]); tmb != nil && avatarFallback == "" {
				thumbs := asSlice(asMap(tmb["avatar"])["thumbnails"])
				if len(thumbs) > 0 {
					avatarFallback = asString(asMap(thumbs[len(thumbs)-1])["url"])
				}
			}
			for _, child := range v {
				walk(child)
			}
		}
	}
	walk(data)

	rawHandle := strings.TrimSpace(extractText(asMap(header)["channelHandle"]))
	handle := ""
	if rawHandle != "" {
		if strings.HasPrefix(rawHandle, "@") {
			handle = rawHandle
		} else {
			handle = "@" + rawHandle
		}
	}
	name := strings.TrimSpace(extractText(asMap(header)["accountName"]))
	if name == "" && handle != "" {
		name = handle[1:]
	}
	email := strings.TrimSpace(extractText(asMap(header)["email"]))
	photoArr := asSlice(asMap(asMap(header)["accountPhoto"])["thumbnails"])
	avatarURL := avatarFallback
	if len(photoArr) > 0 {
		if last := asString(asMap(photoArr[len(photoArr)-1])["url"]); last != "" {
			avatarURL = last
		}
	}
	return AccountIdentity{
		Name:      name,
		Handle:    handle,
		Email:     email,
		AvatarURL: avatarURL,
	}
}

func FetchAccountIdentity(ctx context.Context, session *CookieSession, initialData map[string]any) AccountIdentity {
	var id AccountIdentity
	if session != nil && session.CookieHeader != "" {
		if menuData, err := InnerTubePost(ctx, "/youtubei/v1/account/account_menu", map[string]any{}, session, "/feed/playlists"); err == nil {
			id = ParseAccountIdentityFromMenu(menuData)
		}
	}
	if initialData != nil {
		top := ParseAccountIdentityFromMenu(initialData)
		if id.Name == "" {
			id.Name = top.Name
		}
		if id.Handle == "" {
			id.Handle = top.Handle
		}
		if id.Email == "" {
			id.Email = top.Email
		}
		if id.AvatarURL == "" {
			id.AvatarURL = top.AvatarURL
		}
	}
	if id.Name == "" {
		id.Name = "YouTube Account"
	}
	return id
}

func extractPlaylistIDFromLockup(lv map[string]any) string {
	direct := strings.TrimPrefix(strings.TrimSpace(asString(lv["contentId"])), "VL")
	if direct != "" && !strings.HasPrefix(direct, "RD") {
		return direct
	}

	var resolved string
	var walk func(cur any)
	walk = func(cur any) {
		if resolved != "" {
			return
		}
		switch v := cur.(type) {
		case []any:
			for _, it := range v {
				walk(it)
			}
		case map[string]any:
			if bid := strings.TrimPrefix(strings.TrimSpace(asString(asMap(v["browseEndpoint"])["browseId"])), "VL"); playlistIDRe.MatchString(bid) {
				resolved = bid
				return
			}
			if pid := strings.TrimSpace(asString(asMap(v["watchEndpoint"])["playlistId"])); pid != "" && !strings.HasPrefix(pid, "RD") {
				resolved = pid
				return
			}
			if urlStr := asString(asMap(asMap(v["commandMetadata"])["webCommandMetadata"])["url"]); strings.Contains(urlStr, "list=") {
				if m := listParamRe.FindStringSubmatch(urlStr); len(m) >= 2 && !strings.HasPrefix(m[1], "RD") {
					resolved = m[1]
					return
				}
			}
			for _, child := range v {
				walk(child)
			}
		}
	}
	walk(lv)
	return resolved
}

// ParsePlaylistCardsFromNode parses both 2026 lockupViewModel and legacy gridPlaylistRenderer/playlistRenderer cards.
func ParsePlaylistCardsFromNode(node any, out *[]RemotePlaylist, seen map[string]bool) {
	switch v := node.(type) {
	case []any:
		for _, item := range v {
			ParsePlaylistCardsFromNode(item, out, seen)
		}
	case map[string]any:
		if lv := asMap(v["lockupViewModel"]); lv != nil {
			ct := strings.ToUpper(asString(lv["contentType"]))
			hasColl := asMap(asMap(lv["contentImage"])["collectionThumbnailViewModel"]) != nil
			if strings.Contains(ct, "PLAYLIST") || hasColl {
				pid := extractPlaylistIDFromLockup(lv)
				if pid != "" && !strings.HasPrefix(pid, "RD") && !seen[pid] {
					seen[pid] = true
					meta := asMap(lv["metadata"])
					lvm := asMap(meta["lockupMetadataViewModel"])
					title := strings.TrimSpace(extractText(lvm["title"]))
					if title == "" {
						title = "YouTube Playlist"
					}
					primaryThumb := asMap(asMap(asMap(asMap(lv["contentImage"])["collectionThumbnailViewModel"])["primaryThumbnail"])["thumbnailViewModel"])
					sources := asSlice(asMap(primaryThumb["image"])["sources"])
					cover := ""
					if len(sources) > 0 {
						cover = asString(asMap(sources[len(sources)-1])["url"])
					}
					videoCount := 0
					for _, ovAny := range asSlice(primaryThumb["overlays"]) {
						ov := asMap(ovAny)
						for _, bAny := range asSlice(asMap(ov["thumbnailOverlayBadgeViewModel"])["thumbnailBadges"]) {
							txt := extractText(asMap(asMap(bAny)["thumbnailBadgeViewModel"])["text"])
							if m := digitsOnlyRe.FindString(txt); m != "" {
								cleaned := strings.ReplaceAll(strings.ReplaceAll(m, ",", ""), ".", "")
								if n, err := strconv.Atoi(cleaned); err == nil {
									videoCount = n
									break
								}
							}
						}
						if videoCount > 0 {
							break
						}
					}
					*out = append(*out, RemotePlaylist{
						YoutubePlaylistID: pid,
						Name:              title,
						CoverImage:        cover,
						VideoCount:        videoCount,
						YtEditable:        pid != "LL",
					})
				}
				return
			}
		}

		gpr := asMap(v["gridPlaylistRenderer"])
		if gpr == nil {
			gpr = asMap(v["playlistRenderer"])
		}
		if gpr != nil {
			pid := strings.TrimSpace(asString(gpr["playlistId"]))
			if pid != "" && !strings.HasPrefix(pid, "RD") && !seen[pid] {
				seen[pid] = true
				thumbArr := asSlice(asMap(gpr["thumbnail"])["thumbnails"])
				if len(thumbArr) == 0 {
					if tList := asSlice(gpr["thumbnails"]); len(tList) > 0 {
						thumbArr = asSlice(asMap(tList[0])["thumbnails"])
					}
				}
				cover := ""
				if len(thumbArr) > 0 {
					cover = asString(asMap(thumbArr[len(thumbArr)-1])["url"])
				}
				title := strings.TrimSpace(extractText(gpr["title"]))
				if title == "" {
					title = "YouTube Playlist"
				}
				countTxt := nonDigitsRe.ReplaceAllString(extractText(gpr["videoCountShortText"]), "")
				if countTxt == "" {
					countTxt = nonDigitsRe.ReplaceAllString(extractText(gpr["videoCountText"]), "")
				}
				vc, _ := strconv.Atoi(countTxt)
				*out = append(*out, RemotePlaylist{
					YoutubePlaylistID: pid,
					Name:              title,
					Description:       strings.TrimSpace(extractText(gpr["shortBylineText"])),
					CoverImage:        cover,
					VideoCount:        vc,
					YtEditable:        pid != "LL",
				})
				return
			}
		}

		for _, child := range v {
			ParsePlaylistCardsFromNode(child, out, seen)
		}
	}
}

func FetchUserFeedPlaylists(ctx context.Context, session *CookieSession, initialData map[string]any, handle string) ([]RemotePlaylist, error) {
	if session == nil || session.CookieHeader == "" {
		return nil, errors.New("YouTube browser session cookies are required to load /feed/playlists.")
	}
	playlists := make([]RemotePlaylist, 0)
	seen := make(map[string]bool)

	followContinuations := func(root map[string]any) {
		cur := root
		for page := 1; page < 5; page++ {
			tok := findContinuationToken(cur)
			if tok == "" {
				break
			}
			nextData, err := InnerTubePost(ctx, "/youtubei/v1/browse", map[string]any{"continuation": tok}, session, "/feed/playlists")
			if err != nil {
				break
			}
			before := len(playlists)
			ParsePlaylistCardsFromNode(nextData, &playlists, seen)
			cur = nextData
			if len(playlists) == before {
				break
			}
		}
	}

	if initialData != nil {
		ParsePlaylistCardsFromNode(initialData, &playlists, seen)
		followContinuations(initialData)
	}

	primaryData, err := InnerTubePost(ctx, "/youtubei/v1/browse", map[string]any{"browseId": "FEplaylist_aggregation"}, session, "/feed/playlists")
	if err == nil {
		ParsePlaylistCardsFromNode(primaryData, &playlists, seen)
		followContinuations(primaryData)
	}
	if len(playlists) == 0 {
		if libData, libErr := InnerTubePost(ctx, "/youtubei/v1/browse", map[string]any{"browseId": "FElibrary"}, session, "/feed/playlists"); libErr == nil {
			ParsePlaylistCardsFromNode(libData, &playlists, seen)
			followContinuations(libData)
		}
	}
	if len(playlists) == 0 && handle != "" {
		cleanH := handle
		if !strings.HasPrefix(cleanH, "@") {
			cleanH = "@" + cleanH
		}
		if nav, navErr := InnerTubePost(ctx, "/youtubei/v1/navigation/resolve_url", map[string]any{"url": fmt.Sprintf("%s/%s/playlists", ytOrigin, cleanH)}, session, "/"+cleanH+"/playlists"); navErr == nil {
			if ep := asMap(asMap(nav["endpoint"])["browseEndpoint"]); ep != nil && asString(ep["browseId"]) != "" {
				body := map[string]any{"browseId": asString(ep["browseId"])}
				if p := asString(ep["params"]); p != "" {
					body["params"] = p
				}
				if chData, chErr := InnerTubePost(ctx, "/youtubei/v1/browse", body, session, "/"+cleanH+"/playlists"); chErr == nil {
					ParsePlaylistCardsFromNode(chData, &playlists, seen)
					followContinuations(chData)
				}
			}
		}
	}

	if len(playlists) == 0 {
		if primaryData != nil && responseLooksLoggedOut(primaryData) {
			return nil, errors.New("YouTube returned a signed-out /feed/playlists view. Please re-connect your YouTube cookies.")
		}
		return nil, errors.New("YouTube returned 0 playlists from /feed/playlists (session token may have rotated).")
	}
	return playlists, nil
}

func findSetVideoIDInNode(node any, targetPlaylistID string) string {
	switch v := node.(type) {
	case []any:
		for _, item := range v {
			if found := findSetVideoIDInNode(item, targetPlaylistID); found != "" {
				return found
			}
		}
	case map[string]any:
		if sv := asString(v["setVideoId"]); sv != "" {
			return sv
		}
		if ep := asMap(v["playlistEditEndpoint"]); ep != nil && (targetPlaylistID == "" || asString(ep["playlistId"]) == targetPlaylistID) {
			for _, actAny := range asSlice(ep["actions"]) {
				if sv := asString(asMap(actAny)["setVideoId"]); sv != "" {
					return sv
				}
			}
		}
		for key, child := range v {
			if key == "thumbnailHoverOverlayToggleActionsViewModel" {
				continue
			}
			if found := findSetVideoIDInNode(child, targetPlaylistID); found != "" {
				return found
			}
		}
	}
	return ""
}

func parseVideosFromNode(node any, playlistID string, out *[]RemoteTrack, seen map[string]bool) {
	switch v := node.(type) {
	case []any:
		for _, item := range v {
			parseVideosFromNode(item, playlistID, out, seen)
		}
	case map[string]any:
		if lv := asMap(v["lockupViewModel"]); lv != nil {
			ct := asString(lv["contentType"])
			cid := strings.TrimSpace(asString(lv["contentId"]))
			if ct == "LOCKUP_CONTENT_TYPE_VIDEO" || (!strings.Contains(strings.ToUpper(ct), "PLAYLIST") && len(cid) == 11) {
				vid := cid
				if vid == "" {
					vid = strings.TrimSpace(asString(asMap(asMap(asMap(asMap(lv["rendererContext"])["commandContext"])["onTap"])["innertubeCommand"])["watchEndpoint"]))
				}
				if videoIDPattern.MatchString(vid) {
					setVideoID := findSetVideoIDInNode(lv["metadata"], playlistID)
					uniqKey := "vid:" + vid
					if setVideoID != "" {
						uniqKey = "sv:" + setVideoID
					}
					if !seen[uniqKey] {
						seen[uniqKey] = true
						meta := asMap(asMap(lv["metadata"])["lockupMetadataViewModel"])
						title := strings.TrimSpace(extractText(meta["title"]))
						if title == "" {
							title = fmt.Sprintf("YouTube Video (%s)", vid)
						}
						rows := asSlice(asMap(meta["metadata"])["metadataRows"])
						if len(rows) == 0 {
							rows = asSlice(asMap(asMap(meta["metadata"])["contentMetadataViewModel"])["metadataRows"])
						}
						artist := ""
						if len(rows) > 0 {
							parts := asSlice(asMap(rows[0])["metadataParts"])
							if len(parts) > 0 {
								artist = strings.TrimSpace(extractText(asMap(parts[0])["text"]))
							}
						}
						if artist == "" {
							artist = "YouTube"
						}
						tvm := asMap(asMap(lv["contentImage"])["thumbnailViewModel"])
						sources := asSlice(asMap(tvm["image"])["sources"])
						thumbURL := fmt.Sprintf("https://i.ytimg.com/vi/%s/hqdefault.jpg", vid)
						if len(sources) > 0 {
							if s := asString(asMap(sources[len(sources)-1])["url"]); s != "" {
								thumbURL = s
							}
						}
						dur := 0
						for _, ovAny := range asSlice(tvm["overlays"]) {
							ov := asMap(ovAny)
							badges := asSlice(asMap(ov["thumbnailBottomOverlayViewModel"])["badges"])
							if len(badges) == 0 {
								badges = asSlice(asMap(ov["thumbnailOverlayBadgeViewModel"])["thumbnailBadges"])
							}
							for _, bAny := range badges {
								if d := ParseDurationToSeconds(extractText(asMap(asMap(bAny)["thumbnailBadgeViewModel"])["text"])); d > 0 {
									dur = d
									break
								}
							}
							if dur > 0 {
								break
							}
						}
						*out = append(*out, RemoteTrack{
							YoutubeID:    vid,
							YtSetVideoID: setVideoID,
							Title:        title,
							Artist:       artist,
							Duration:     dur,
							ThumbnailURL: thumbURL,
							URL:          "https://www.youtube.com/watch?v=" + vid,
							SourceType:   "youtube",
						})
					}
				}
				return
			}
		}

		if pvr := asMap(v["playlistVideoRenderer"]); pvr != nil {
			vid := strings.TrimSpace(asString(pvr["videoId"]))
			if videoIDPattern.MatchString(vid) {
				setVideoID := asString(pvr["setVideoId"])
				uniqKey := "vid:" + vid
				if setVideoID != "" {
					uniqKey = "sv:" + setVideoID
				}
				if !seen[uniqKey] {
					seen[uniqKey] = true
					thumbs := asSlice(asMap(pvr["thumbnail"])["thumbnails"])
					thumbURL := fmt.Sprintf("https://i.ytimg.com/vi/%s/hqdefault.jpg", vid)
					if len(thumbs) > 0 {
						if u := asString(asMap(thumbs[len(thumbs)-1])["url"]); u != "" {
							thumbURL = u
						}
					}
					dur := 0
					if ls := asString(pvr["lengthSeconds"]); ls != "" {
						dur, _ = strconv.Atoi(ls)
					}
					if dur <= 0 {
						dur = ParseDurationToSeconds(extractText(pvr["lengthText"]))
					}
					title := strings.TrimSpace(extractText(pvr["title"]))
					if title == "" {
						title = fmt.Sprintf("YouTube Video (%s)", vid)
					}
					artist := strings.TrimSpace(extractText(pvr["shortBylineText"]))
					if artist == "" {
						artist = "YouTube"
					}
					*out = append(*out, RemoteTrack{
						YoutubeID:    vid,
						YtSetVideoID: setVideoID,
						Title:        title,
						Artist:       artist,
						Duration:     dur,
						ThumbnailURL: thumbURL,
						URL:          "https://www.youtube.com/watch?v=" + vid,
						SourceType:   "youtube",
					})
				}
			}
			return
		}

		for _, child := range v {
			parseVideosFromNode(child, playlistID, out, seen)
		}
	}
}

func extractPlaylistHeaderMeta(data map[string]any, fallbackID string) (title, desc, cover string, editable bool) {
	header := asMap(data["header"])
	pageHeader := asMap(header["pageHeaderRenderer"])
	pageVm := asMap(asMap(pageHeader["content"])["pageHeaderViewModel"])
	legacy := asMap(header["playlistHeaderRenderer"])

	title = strings.TrimSpace(extractText(asMap(asMap(pageVm["title"])["dynamicTextViewModel"])["text"]))
	if title == "" {
		title = strings.TrimSpace(asString(pageHeader["pageTitle"]))
	}
	if title == "" {
		title = strings.TrimSpace(extractText(legacy["title"]))
	}
	if title == "" {
		title = fmt.Sprintf("YouTube Playlist (%s)", fallbackID)
	}

	desc = strings.TrimSpace(extractText(asMap(asMap(pageVm["description"])["descriptionPreviewViewModel"])["description"]))
	if desc == "" {
		desc = strings.TrimSpace(extractText(legacy["descriptionText"]))
	}

	heroSources := asSlice(asMap(asMap(asMap(pageVm["heroImage"])["contentPreviewImageViewModel"])["image"])["sources"])
	if len(heroSources) == 0 {
		heroSources = asSlice(asMap(asMap(asMap(legacy["playlistHeaderBanner"])["heroPlaylistThumbnailRenderer"])["thumbnail"])["thumbnails"])
	}
	if len(heroSources) > 0 {
		cover = asString(asMap(heroSources[len(heroSources)-1])["url"])
	}
	if ed, ok := legacy["isEditable"].(bool); ok {
		editable = ed
	}
	return title, desc, cover, editable
}

func FetchPlaylistVideos(ctx context.Context, playlistID string, session *CookieSession, maxPages int) (RemotePlaylist, error) {
	cleanID := strings.TrimPrefix(strings.TrimSpace(playlistID), "VL")
	if cleanID == "" {
		return RemotePlaylist{}, errors.New("YouTube playlist ID is required.")
	}
	if maxPages <= 0 {
		maxPages = 5
	}

	tracks := make([]RemoteTrack, 0)
	seen := make(map[string]bool)
	var title, desc, cover string
	var editable bool

	referer := "/playlist?list=" + url.QueryEscape(cleanID)
	data, err := InnerTubePost(ctx, "/youtubei/v1/browse", map[string]any{"browseId": "VL" + cleanID}, session, referer)
	if err == nil {
		title, desc, cover, editable = extractPlaylistHeaderMeta(data, cleanID)
		parseVideosFromNode(data, cleanID, &tracks, seen)
		cur := data
		for page := 1; page < maxPages; page++ {
			tok := findContinuationToken(cur)
			if tok == "" {
				break
			}
			nextData, nextErr := InnerTubePost(ctx, "/youtubei/v1/browse", map[string]any{"continuation": tok}, session, referer)
			if nextErr != nil {
				break
			}
			before := len(tracks)
			parseVideosFromNode(nextData, cleanID, &tracks, seen)
			cur = nextData
			if len(tracks) == before {
				break
			}
		}
	} else if session == nil || session.CookieHeader == "" {
		return RemotePlaylist{}, err
	}

	if len(tracks) == 0 && session != nil && session.CookieHeader != "" {
		req, reqErr := http.NewRequestWithContext(ctx, http.MethodGet, ytOrigin+"/playlist?list="+url.QueryEscape(cleanID), nil)
		if reqErr == nil {
			req.Header.Set("Cookie", session.CookieHeader)
			req.Header.Set("User-Agent", userAgent)
			req.Header.Set("Accept-Language", "en-US,en;q=0.9")
			client := newHTTPClient(15 * time.Second)
			if resp, rErr := client.Do(req); rErr == nil {
				if resp.StatusCode >= 200 && resp.StatusCode < 300 {
					if b, readErr := io.ReadAll(resp.Body); readErr == nil {
						if htmlData := ExtractJSONAssignment(string(b), "var ytInitialData ="); htmlData != nil {
							ht, hd, hc, he := extractPlaylistHeaderMeta(htmlData, cleanID)
							if title == "" {
								title = ht
							}
							if desc == "" {
								desc = hd
							}
							if cover == "" {
								cover = hc
							}
							editable = editable || he
							parseVideosFromNode(htmlData, cleanID, &tracks, seen)
						}
					}
				}
				resp.Body.Close()
			}
		}
	}

	if title == "" {
		title = fmt.Sprintf("YouTube Playlist (%s)", cleanID)
	}
	if cover == "" && len(tracks) > 0 {
		cover = tracks[0].ThumbnailURL
	}
	return RemotePlaylist{
		YoutubePlaylistID: cleanID,
		Name:              title,
		Description:       desc,
		CoverImage:        cover,
		VideoCount:        len(tracks),
		YtEditable:        editable || (session != nil && cleanID != "LL"),
		Tracks:            tracks,
	}, nil
}

func FetchPublicImport(ctx context.Context, rawInput string) ([]RemotePlaylist, error) {
	trimmed := strings.TrimSpace(rawInput)
	if trimmed == "" {
		return nil, errors.New("Enter a YouTube playlist URL, playlist ID, or @channel handle.")
	}

	listID := ""
	if publicImportIDRe.MatchString(trimmed) {
		listID = trimmed
	} else {
		norm := trimmed
		if !regexp.MustCompile(`(?i)^https?://`).MatchString(norm) {
			if strings.HasPrefix(norm, "@") {
				norm = fmt.Sprintf("%s/%s/playlists", ytOrigin, norm)
			} else {
				norm = "https://" + norm
			}
		}
		if u, err := url.Parse(norm); err == nil {
			listID = u.Query().Get("list")
		}
	}

	if listID != "" {
		pl, err := FetchPlaylistVideos(ctx, listID, nil, 5)
		if err != nil {
			return nil, err
		}
		return []RemotePlaylist{pl}, nil
	}

	targetURL := ""
	if strings.HasPrefix(trimmed, "@") {
		targetURL = fmt.Sprintf("%s/%s/playlists", ytOrigin, trimmed)
	} else if regexp.MustCompile(`(?i)^https?://`).MatchString(trimmed) {
		targetURL = strings.TrimRight(trimmed, "/")
		if !strings.Contains(targetURL, "/playlists") {
			targetURL += "/playlists"
		}
	} else {
		targetURL = fmt.Sprintf("%s/@%s/playlists", ytOrigin, strings.TrimPrefix(trimmed, "@"))
	}

	nav, err := InnerTubePost(ctx, "/youtubei/v1/navigation/resolve_url", map[string]any{"url": targetURL}, nil, "/feed/playlists")
	if err != nil {
		return nil, err
	}
	ep := asMap(asMap(nav["endpoint"])["browseEndpoint"])
	browseID := asString(ep["browseId"])
	if browseID == "" {
		return nil, errors.New("Could not resolve that YouTube playlist link or channel handle.")
	}
	body := map[string]any{"browseId": browseID}
	if p := asString(ep["params"]); p != "" {
		body["params"] = p
	}
	browseData, err := InnerTubePost(ctx, "/youtubei/v1/browse", body, nil, "/feed/playlists")
	if err != nil {
		return nil, err
	}

	cards := make([]RemotePlaylist, 0)
	seen := make(map[string]bool)
	ParsePlaylistCardsFromNode(browseData, &cards, seen)
	if len(cards) == 0 {
		return nil, errors.New("No public playlists found on that YouTube channel.")
	}
	if len(cards) > 12 {
		cards = cards[:12]
	}

	out := make([]RemotePlaylist, 0, len(cards))
	for _, card := range cards {
		pl, err := FetchPlaylistVideos(ctx, card.YoutubePlaylistID, nil, 3)
		if err != nil {
			continue
		}
		if card.Name != "" {
			pl.Name = card.Name
		}
		if card.Description != "" {
			pl.Description = card.Description
		}
		if card.CoverImage != "" {
			pl.CoverImage = card.CoverImage
		}
		out = append(out, pl)
	}
	return out, nil
}

// --- 2-Way Sync Mutation Helpers ---

func CreateYouTubePlaylist(ctx context.Context, session *CookieSession, title, description, privacyStatus string) (string, error) {
	if strings.TrimSpace(title) == "" {
		title = "Untitled Playlist"
	}
	if privacyStatus == "" {
		privacyStatus = "PRIVATE"
	}
	data, err := InnerTubePost(ctx, "/youtubei/v1/playlist/create", map[string]any{
		"title":         strings.TrimSpace(title),
		"privacyStatus": privacyStatus,
		"videoIds":      []string{},
	}, session, "/feed/playlists")
	if err != nil {
		return "", err
	}
	pid := strings.TrimSpace(asString(data["playlistId"]))
	if pid == "" {
		return "", errors.New("YouTube did not return a playlistId when creating the playlist.")
	}
	if trimmedDesc := strings.TrimSpace(description); trimmedDesc != "" {
		_, _ = InnerTubePost(ctx, "/youtubei/v1/browse/edit_playlist", map[string]any{
			"playlistId": pid,
			"actions": []map[string]any{{
				"action":              "ACTION_SET_PLAYLIST_DESCRIPTION",
				"playlistDescription": trimmedDesc,
			}},
		}, session, "/playlist?list="+pid)
	}
	return pid, nil
}

func UpdateYouTubePlaylist(ctx context.Context, session *CookieSession, ytPlaylistID string, title, description *string) error {
	cleanID := strings.TrimSpace(ytPlaylistID)
	if cleanID == "" || cleanID == "WL" || cleanID == "LL" || cleanID == "LM" {
		return nil
	}
	actions := make([]map[string]any, 0, 2)
	if title != nil {
		actions = append(actions, map[string]any{
			"action":       "ACTION_SET_PLAYLIST_NAME",
			"playlistName": strings.TrimSpace(*title),
		})
	}
	if description != nil {
		actions = append(actions, map[string]any{
			"action":              "ACTION_SET_PLAYLIST_DESCRIPTION",
			"playlistDescription": strings.TrimSpace(*description),
		})
	}
	if len(actions) == 0 {
		return nil
	}
	_, err := InnerTubePost(ctx, "/youtubei/v1/browse/edit_playlist", map[string]any{
		"playlistId": cleanID,
		"actions":    actions,
	}, session, "/playlist?list="+cleanID)
	return err
}

func DeleteYouTubePlaylist(ctx context.Context, session *CookieSession, ytPlaylistID string) error {
	cleanID := strings.TrimSpace(ytPlaylistID)
	if cleanID == "" || cleanID == "WL" || cleanID == "LL" || cleanID == "LM" {
		return errors.New("System YouTube playlists (WL/LL) cannot be deleted.")
	}
	_, err := InnerTubePost(ctx, "/youtubei/v1/playlist/delete", map[string]any{
		"playlistId": cleanID,
	}, session, "/feed/playlists")
	return err
}

func AddVideoToYouTubePlaylist(ctx context.Context, session *CookieSession, ytPlaylistID, videoID string) (string, error) {
	cleanID := strings.TrimSpace(ytPlaylistID)
	cleanVid := strings.TrimSpace(videoID)
	if cleanID == "" || cleanVid == "" {
		return "", nil
	}
	data, err := InnerTubePost(ctx, "/youtubei/v1/browse/edit_playlist", map[string]any{
		"playlistId": cleanID,
		"actions": []map[string]any{{
			"action":       "ACTION_ADD_VIDEO",
			"addedVideoId": cleanVid,
		}},
	}, session, "/playlist?list="+cleanID)
	if err != nil {
		return "", err
	}
	for _, resAny := range asSlice(data["playlistEditResults"]) {
		if sv := asString(asMap(asMap(resAny)["playlistEditVideoAddedResultData"])["setVideoId"]); sv != "" {
			return sv, nil
		}
	}
	return findSetVideoIDInNode(data, cleanID), nil
}

func RemoveVideoFromYouTubePlaylist(ctx context.Context, session *CookieSession, ytPlaylistID, videoID, setVideoID string) error {
	cleanID := strings.TrimSpace(ytPlaylistID)
	if cleanID == "" || cleanID == "LL" {
		return nil
	}
	if setVideoID != "" {
		action := map[string]any{
			"action":     "ACTION_REMOVE_VIDEO",
			"setVideoId": setVideoID,
		}
		if videoID != "" {
			action["removedVideoId"] = videoID
		}
		if _, err := InnerTubePost(ctx, "/youtubei/v1/browse/edit_playlist", map[string]any{
			"playlistId": cleanID,
			"actions":    []map[string]any{action},
		}, session, "/playlist?list="+cleanID); err == nil {
			return nil
		}
	}
	if videoID != "" {
		_, err := InnerTubePost(ctx, "/youtubei/v1/browse/edit_playlist", map[string]any{
			"playlistId": cleanID,
			"actions": []map[string]any{{
				"action":         "ACTION_REMOVE_VIDEO_BY_VIDEO_ID",
				"removedVideoId": videoID,
			}},
		}, session, "/playlist?list="+cleanID)
		return err
	}
	return nil
}

func ReorderVideoInYouTubePlaylist(ctx context.Context, session *CookieSession, ytPlaylistID, setVideoID, predecessorSetVideoID string) error {
	cleanID := strings.TrimSpace(ytPlaylistID)
	if cleanID == "" || setVideoID == "" || cleanID == "LL" {
		return nil
	}
	action := map[string]any{
		"action":     "ACTION_MOVE_VIDEO_AFTER",
		"setVideoId": setVideoID,
	}
	if predecessorSetVideoID != "" {
		action["movedSetVideoIdPredecessor"] = predecessorSetVideoID
	}
	_, err := InnerTubePost(ctx, "/youtubei/v1/browse/edit_playlist", map[string]any{
		"playlistId": cleanID,
		"actions":    []map[string]any{action},
	}, session, "/playlist?list="+cleanID)
	return err
}

// ResolvePublicChannelSession fetches public channel profile and playlists from @handle or channel URL.
func ResolvePublicChannelSession(ctx context.Context, rawInput string) (AccountIdentity, []RemotePlaylist, error) {
	trimmed := strings.TrimSpace(rawInput)
	if trimmed == "" {
		return AccountIdentity{}, nil, errors.New("Masukkan @handle channel YouTube atau URL channel Anda.")
	}

	normalizedHandle := ""
	if strings.HasPrefix(trimmed, "@") {
		normalizedHandle = trimmed
	} else if !regexp.MustCompile(`(?i)^https?://`).MatchString(trimmed) {
		normalizedHandle = "@" + strings.TrimPrefix(trimmed, "@")
	}

	targetURL := ""
	if regexp.MustCompile(`(?i)^https?://`).MatchString(trimmed) {
		targetURL = strings.TrimRight(trimmed, "/")
		if !strings.Contains(targetURL, "/playlists") {
			targetURL += "/playlists"
		}
	} else {
		targetURL = fmt.Sprintf("%s/%s/playlists", ytOrigin, normalizedHandle)
	}

	nav, err := InnerTubePost(ctx, "/youtubei/v1/navigation/resolve_url", map[string]any{"url": targetURL}, nil, "/feed/playlists")
	if err != nil {
		return AccountIdentity{}, nil, err
	}
	ep := asMap(asMap(nav["endpoint"])["browseEndpoint"])
	browseID := asString(ep["browseId"])
	if browseID == "" {
		return AccountIdentity{}, nil, errors.New("Channel YouTube tidak ditemukan. Pastikan @handle atau URL benar.")
	}
	body := map[string]any{"browseId": browseID}
	if p := asString(ep["params"]); p != "" {
		body["params"] = p
	}
	browseData, err := InnerTubePost(ctx, "/youtubei/v1/browse", body, nil, "/feed/playlists")
	if err != nil {
		return AccountIdentity{}, nil, err
	}

	meta := asMap(asMap(browseData["metadata"])["channelMetadataRenderer"])
	thumbs := asSlice(asMap(meta["avatar"])["thumbnails"])
	avatarURL := ""
	if len(thumbs) > 0 {
		avatarURL = asString(asMap(thumbs[len(thumbs)-1])["url"])
	}
	handle := normalizedHandle
	for _, field := range []string{asString(meta["vanityChannelUrl"]), asString(meta["channelUrl"])} {
		if idx := strings.Index(field, "/@"); idx != -1 {
			sub := field[idx+1:]
			if end := strings.IndexAny(sub, "/?#"); end != -1 {
				sub = sub[:end]
			}
			if sub != "" {
				handle = sub
				break
			}
		}
	}
	name := strings.TrimSpace(asString(meta["title"]))
	if name == "" && handle != "" {
		name = strings.TrimPrefix(handle, "@")
	}
	if name == "" {
		name = "YouTube User"
	}

	cards := make([]RemotePlaylist, 0)
	seen := make(map[string]bool)
	ParsePlaylistCardsFromNode(browseData, &cards, seen)
	if len(cards) > 12 {
		cards = cards[:12]
	}

	out := make([]RemotePlaylist, 0, len(cards))
	for _, card := range cards {
		pl, err := FetchPlaylistVideos(ctx, card.YoutubePlaylistID, nil, 3)
		if err != nil {
			continue
		}
		if card.Name != "" {
			pl.Name = card.Name
		}
		if card.Description != "" {
			pl.Description = card.Description
		}
		if card.CoverImage != "" {
			pl.CoverImage = card.CoverImage
		}
		pl.YtEditable = false
		out = append(out, pl)
	}

	return AccountIdentity{
		Name:      name,
		Handle:    handle,
		AvatarURL: avatarURL,
	}, out, nil
}
