package youtube

import (
	"strings"
	"testing"
)

func TestParseDurationAndJSONHelpers(t *testing.T) {
	if got := ParseDurationToSeconds("3:58"); got != 238 {
		t.Fatalf("ParseDurationToSeconds(3:58) = %d, want 238", got)
	}
	if got := ParseDurationToSeconds("1.02.15"); got != 3735 {
		t.Fatalf("ParseDurationToSeconds(1.02.15) = %d, want 3735", got)
	}

	fakeHTML := `<html><script>ytcfg.set({"SESSION_INDEX":"0","DELEGATED_SESSION_ID":"1077213301999","DATASYNC_ID":"11223344||","VISITOR_DATA":"CgtTest","LOGGED_IN":true}); var ytInitialData = {"header":{"c":"hello"},"arr":[1,2]};</script></html>`
	cfg := ExtractYtCfgFromHTML(fakeHTML)
	if !cfg.LoggedIn || cfg.SessionIndex != "0" || cfg.DelegatedSessionID != "1077213301999" || cfg.DatasyncID != "11223344||" || cfg.VisitorData != "CgtTest" {
		t.Fatalf("unexpected ytcfg: %+v", cfg)
	}
	initData := ExtractJSONAssignment(fakeHTML, "var ytInitialData =")
	if initData == nil || asMap(initData["header"])["c"] != "hello" {
		t.Fatalf("unexpected ytInitialData: %+v", initData)
	}
}

func TestBuildSapisidAuthorization(t *testing.T) {
	cookies := map[string]string{"SAPISID": "TEST_SAPISID", "SID": "TEST_SID"}
	authU := BuildSapisidAuthorization(cookies, "11223344||55", true)
	if !strings.Contains(authU, "_u") || !strings.HasPrefix(authU, "SAPISIDHASH ") {
		t.Fatalf("expected _u SAPISIDHASH, got %q", authU)
	}

	authVisitor := BuildSapisidAuthorization(cookies, "V5ad72ab7||", true)
	if strings.Contains(authVisitor, "_u") || !strings.HasPrefix(authVisitor, "SAPISIDHASH ") {
		t.Fatalf("visitor datasync V... must not include _u, got %q", authVisitor)
	}

	authPlain := BuildSapisidAuthorization(cookies, "11223344||", false)
	if strings.Contains(authPlain, "_u") {
		t.Fatalf("useDatasync=false must not include _u, got %q", authPlain)
	}
}

func TestParseCookieInput(t *testing.T) {
	sess, err := ParseCookieInput(nil, "Cookie: SAPISID=abc123; SID=sidval; PREF=tz=Asia.Jakarta")
	if err != nil {
		t.Fatalf("unexpected cookie header error: %v", err)
	}
	if sess.CookieCount != 3 || sess.CookieMap["SAPISID"] != "abc123" {
		t.Fatalf("unexpected parsed cookie session: %+v", sess)
	}

	if _, err := ParseCookieInput(nil, "PREF=only"); err == nil {
		t.Fatal("expected error when SAPISID/SID are missing")
	}
}

func TestParseCardsIdentityAndSearch(t *testing.T) {
	tree := map[string]any{
		"items": []any{
			map[string]any{
				"lockupViewModel": map[string]any{
					"contentType": "LOCKUP_CONTENT_TYPE_PLAYLIST",
					"contentId":   "PLprivate12345",
					"metadata": map[string]any{
						"lockupMetadataViewModel": map[string]any{
							"title": map[string]any{"content": "City Pop & Diskoria"},
						},
					},
				},
			},
			map[string]any{
				"lockupViewModel": map[string]any{
					"contentType": "LOCKUP_CONTENT_TYPE_PLAYLIST",
					"contentId":   "RDAMVMxyz999",
					"metadata": map[string]any{
						"lockupMetadataViewModel": map[string]any{
							"title": map[string]any{"content": "My Mix"},
						},
					},
				},
			},
		},
	}
	var cards []RemotePlaylist
	ParsePlaylistCardsFromNode(tree, &cards, make(map[string]bool))
	if len(cards) != 1 || cards[0].YoutubePlaylistID != "PLprivate12345" || cards[0].Name != "City Pop & Diskoria" {
		t.Fatalf("unexpected playlist cards: %+v", cards)
	}

	menu := map[string]any{
		"actions": []any{
			map[string]any{
				"openPopupAction": map[string]any{
					"popup": map[string]any{
						"multiPageMenuRenderer": map[string]any{
							"header": map[string]any{
								"activeAccountHeaderRenderer": map[string]any{
									"accountName":   map[string]any{"simpleText": "muhalmuhtadi"},
									"channelHandle": map[string]any{"simpleText": "@muhalmuhtadixyz"},
									"email":         map[string]any{"simpleText": "muhamadalmuhtadi@gmail.com"},
									"accountPhoto": map[string]any{
										"thumbnails": []any{map[string]any{"url": "https://yt3.ggpht.com/avatar=s88"}},
									},
								},
							},
						},
					},
				},
			},
		},
	}
	id := ParseAccountIdentityFromMenu(menu)
	if id.Name != "muhalmuhtadi" || id.Handle != "@muhalmuhtadixyz" || id.AvatarURL == "" {
		t.Fatalf("unexpected identity: %+v", id)
	}

	searchPayload := map[string]any{
		"contents": map[string]any{
			"twoColumnSearchResultsRenderer": map[string]any{
				"primaryContents": map[string]any{
					"sectionListRenderer": map[string]any{
						"contents": []any{
							map[string]any{
								"itemSectionRenderer": map[string]any{
									"contents": []any{
										map[string]any{
											"videoRenderer": map[string]any{
												"videoId":    "dQw4w9WgXcQ",
												"title":      map[string]any{"runs": []any{map[string]any{"text": "Test Song"}}},
												"ownerText":  map[string]any{"runs": []any{map[string]any{"text": "Test Artist"}}},
												"lengthText": map[string]any{"simpleText": "3:33"},
											},
										},
									},
								},
							},
						},
					},
				},
			},
		},
	}
	sr := CollectSearchRenderers(searchPayload)
	if len(sr) != 1 || sr[0].YoutubeID != "dQw4w9WgXcQ" || sr[0].Duration != 213 {
		t.Fatalf("unexpected search results: %+v", sr)
	}
}
