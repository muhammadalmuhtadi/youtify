package media

import "testing"

func TestExtractYouTubeID(t *testing.T) {
	cases := []struct {
		url  string
		want string
	}{
		{"https://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"},
		{"https://youtu.be/dQw4w9WgXcQ?t=42", "dQw4w9WgXcQ"},
		{"https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=RD1", "dQw4w9WgXcQ"},
		{"https://youtube.com/shorts/abcDEF12345", "abcDEF12345"},
		{"https://www.youtube.com/live/xyz98765432", "xyz98765432"},
		{"youtube.com/embed/qweRTY12345", "qweRTY12345"},
		{"https://example.com/audio.mp3", ""},
		{"not-a-url", ""},
	}
	for _, tc := range cases {
		if got := ExtractYouTubeID(tc.url); got != tc.want {
			t.Errorf("ExtractYouTubeID(%q) = %q, want %q", tc.url, got, tc.want)
		}
	}
}

func TestParseMediaURL(t *testing.T) {
	yt, err := ParseMediaURL("https://youtu.be/dQw4w9WgXcQ")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if yt.SourceType != "youtube" || yt.YouTubeID != "dQw4w9WgXcQ" || yt.CanonicalURL != "https://www.youtube.com/watch?v=dQw4w9WgXcQ" {
		t.Fatalf("unexpected youtube parse: %+v", yt)
	}

	sc, err := ParseMediaURL("https://soundcloud.com/artist/track-name")
	if err != nil || sc.SourceType != "soundcloud" {
		t.Fatalf("expected soundcloud parse, got %+v err=%v", sc, err)
	}

	direct, err := ParseMediaURL("https://cdn.example.com/song.mp3")
	if err != nil || direct.SourceType != "audio" {
		t.Fatalf("expected direct audio parse, got %+v err=%v", direct, err)
	}

	if _, err := ParseMediaURL("ftp://example.com/file.mp3"); err == nil {
		t.Fatal("expected error for unsupported scheme")
	}
}
