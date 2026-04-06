package main

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/pbkdf2"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"time"
)

type encryptedMessage struct {
	IV   string `json:"iv"`
	Tag  string `json:"tag"`
	Data string `json:"data"`
	Salt string `json:"salt"`
}

type response struct {
	Percentage float64 `json:"percentage"`
	Locked     bool    `json:"locked"`
	Message    *string `json:"message"`
}

var (
	startDate  time.Time
	targetDate time.Time
	// encryptDateStr is the exact string used as part of the KDF passphrase
	// when the ciphertext in MESSAGE_PATH was produced. In production it
	// matches TARGET_DATE formatted YYYY-MM-DD. In development it can be
	// pinned to a fixed value (via the ENCRYPT_DATE env var) so TARGET_DATE
	// is free to move around while the dev ciphertext stays decryptable.
	encryptDateStr string
	secretKey      string
	encMsg         encryptedMessage

	// plaintext is computed once on first successful decrypt and cached.
	plaintextCache *string
)

func mustEnv(key string) string {
	v := os.Getenv(key)
	if v == "" {
		log.Fatalf("missing required env var: %s", key)
	}
	return v
}

// parseDate accepts YYYY-MM-DD (production) or RFC3339 (dev, lets you set
// a unlock time a few seconds in the future to watch the transition live).
func parseDate(key, raw string) time.Time {
	layouts := []string{
		time.RFC3339,
		"2006-01-02T15:04:05Z",
		"2006-01-02T15:04:05",
		"2006-01-02",
	}
	for _, l := range layouts {
		if t, err := time.Parse(l, raw); err == nil {
			return t.UTC()
		}
	}
	log.Fatalf("invalid %s %q (expected YYYY-MM-DD or RFC3339)", key, raw)
	return time.Time{}
}

func loadMessageFile(path string) encryptedMessage {
	b, err := os.ReadFile(path)
	if err != nil {
		log.Fatalf("failed to read %s: %v", path, err)
	}
	var m encryptedMessage
	if err := json.Unmarshal(b, &m); err != nil {
		log.Fatalf("failed to parse %s: %v", path, err)
	}
	if m.IV == "" || m.Tag == "" || m.Data == "" || m.Salt == "" {
		log.Fatalf("%s missing one of iv/tag/data/salt", path)
	}
	return m
}

// decrypt reproduces the Node scripts/encrypt.mjs format exactly:
// AES-256-GCM, key = pbkdf2(secretKey+targetDateStr, salt, 100_000, 32, sha256).
// The GCM tag is stored separately in Node, but Go's AEAD API expects it
// appended to the ciphertext — so we concatenate data||tag before calling Open.
func decrypt(m encryptedMessage, secret, targetDateStr string) (string, error) {
	salt, err := hex.DecodeString(m.Salt)
	if err != nil {
		return "", err
	}
	iv, err := hex.DecodeString(m.IV)
	if err != nil {
		return "", err
	}
	tag, err := hex.DecodeString(m.Tag)
	if err != nil {
		return "", err
	}
	data, err := hex.DecodeString(m.Data)
	if err != nil {
		return "", err
	}

	key, err := pbkdf2.Key(sha256.New, secret+targetDateStr, salt, 100_000, 32)
	if err != nil {
		return "", err
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCMWithNonceSize(block, len(iv))
	if err != nil {
		return "", err
	}

	ciphertext := append(data, tag...)
	plaintext, err := gcm.Open(nil, iv, ciphertext, nil)
	if err != nil {
		return "", err
	}
	return string(plaintext), nil
}

func computePercentage(now time.Time) float64 {
	total := targetDate.Sub(startDate).Seconds()
	if total <= 0 {
		return 100
	}
	elapsed := now.Sub(startDate).Seconds()
	pct := (elapsed / total) * 100
	if pct < 0 {
		return 0
	}
	if pct >= 100 {
		return 100
	}
	return pct
}

var aboutJSON = []byte(`{
  "title": "The Loading Message",
  "artist": "Elmar Hamelink",
  "year": 2026,
  "description": "A message, written by the artist while alive, encrypted and waiting. A single percentage counts forward from 2026. It will reach 100% on a date centuries from now. At that moment — and only that moment — the message appears for the first time.",
  "note": "The encrypted message is public. The key is not.",
  "source": "https://github.com/friendly-faces/the-loading-message"
}`)

func handleAbout(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "public, max-age=3600")
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	_, _ = w.Write(aboutJSON)
}

func handleRoot(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json")

	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	now := time.Now().UTC()
	pct := computePercentage(now)
	locked := now.Before(targetDate)

	resp := response{
		Percentage: pct,
		Locked:     locked,
		Message:    nil,
	}

	if !locked {
		if plaintextCache == nil {
			pt, err := decrypt(encMsg, secretKey, encryptDateStr)
			if err != nil {
				log.Printf("decrypt failed: %v", err)
			} else {
				plaintextCache = &pt
			}
		}
		resp.Message = plaintextCache
	}

	_ = json.NewEncoder(w).Encode(resp)
}

func main() {
	startDate = parseDate("START_DATE", mustEnv("START_DATE"))
	targetDate = parseDate("TARGET_DATE", mustEnv("TARGET_DATE"))
	secretKey = mustEnv("SECRET_KEY")

	// ENCRYPT_DATE defaults to TARGET_DATE in YYYY-MM-DD form — the exact
	// string scripts/encrypt.mjs uses in its pbkdf2 passphrase. In dev you
	// pin this independently so you can vary TARGET_DATE freely.
	encryptDateStr = os.Getenv("ENCRYPT_DATE")
	if encryptDateStr == "" {
		encryptDateStr = targetDate.Format("2006-01-02")
	}

	messagePath := os.Getenv("MESSAGE_PATH")
	if messagePath == "" {
		messagePath = "/app/message.json"
	}
	encMsg = loadMessageFile(messagePath)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/", handleRoot)
	mux.HandleFunc("/about", handleAbout)

	addr := ":" + port
	log.Printf("listening on %s (start=%s target=%s encrypt=%s)", addr,
		startDate.Format(time.RFC3339),
		targetDate.Format(time.RFC3339),
		encryptDateStr)

	srv := &http.Server{
		Addr:              addr,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}
	if err := srv.ListenAndServe(); err != nil {
		log.Fatal(err)
	}
}
