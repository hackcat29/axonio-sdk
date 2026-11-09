package axonio

import (
	"archive/tar"
	"compress/gzip"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

func releaseBaseCandidates() []string {
	configured := strings.TrimSpace(os.Getenv("CLAWDB_SERVER_RELEASE_BASE_URL"))
	candidates := []string{
		configured,
		"https://github.com/Claw-DB/ClawDB/releases/latest/download",
		"https://github.com/clawdb/clawdb/releases/latest/download",
		"https://github.com/claw-db/clawdb/releases/latest/download",
	}
	result := make([]string, 0, len(candidates))
	seen := map[string]struct{}{}
	for _, candidate := range candidates {
		if candidate == "" {
			continue
		}
		if _, ok := seen[candidate]; ok {
			continue
		}
		seen[candidate] = struct{}{}
		result = append(result, candidate)
	}
	return result
}

// Options configures the Go client using a single struct.
type Options struct {
	Endpoint  string
	APIKey    string
	AgentID   string
	Workspace string
	Role      string
	Timeout   time.Duration
	TLS       bool
}

func applyOptionsStruct(cfg *Config, options Options) {
	if options.Endpoint != "" {
		cfg.Endpoint = options.Endpoint
		cfg.endpointSet = true
	}
	if options.APIKey != "" {
		cfg.APIKey = options.APIKey
	}
	if options.AgentID != "" {
		cfg.AgentID = options.AgentID
	}
	if options.Workspace != "" {
		cfg.Workspace = options.Workspace
	}
	if options.Role != "" {
		cfg.Role = options.Role
	}
	if options.Timeout > 0 {
		cfg.Timeout = options.Timeout
	}
	if options.TLS {
		cfg.TLS = true
	}
}

func platformID() (string, error) {
	switch runtime.GOOS + "/" + runtime.GOARCH {
	case "linux/amd64":
		return "linux-x64", nil
	case "linux/arm64":
		return "linux-arm64", nil
	case "darwin/amd64":
		return "darwin-x64", nil
	case "darwin/arm64":
		return "darwin-arm64", nil
	case "windows/amd64":
		return "win32-x64", nil
	default:
		return "", fmt.Errorf("unsupported platform: %s/%s", runtime.GOOS, runtime.GOARCH)
	}
}

func localServerHealthy() bool {
	conn, err := net.DialTimeout("tcp", "127.0.0.1:50050", 300*time.Millisecond)
	if err != nil {
		return false
	}
	_ = conn.Close()
	return true
}

func spawnLocalServer(binary string) error {
	cmd := exec.Command(binary, "--grpc-port", "50050")
	cmd.Env = os.Environ()
	if os.Getenv("CLAW_GUARD_JWT_SECRET") == "" {
		cmd.Env = append(cmd.Env, "CLAW_GUARD_JWT_SECRET=clawdb-sdk-local-dev-secret")
	}
	if os.Getenv("CLAW_VECTOR_ENABLED") == "" {
		cmd.Env = append(cmd.Env, "CLAW_VECTOR_ENABLED=false")
	}
	cmd.Stdout = io.Discard
	cmd.Stderr = io.Discard
	return cmd.Start()
}

func waitForLocalServer(timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if localServerHealthy() {
			return true
		}
		time.Sleep(100 * time.Millisecond)
	}
	return false
}

func binaryName() string {
	if runtime.GOOS == "windows" {
		return "clawdb-server.exe"
	}
	return "clawdb-server"
}

func installedBinaryPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".clawdb", "bin", binaryName()), nil
}

func extractBinary(archivePath string) (string, error) {
	archiveFile, err := os.Open(archivePath)
	if err != nil {
		return "", err
	}
	defer archiveFile.Close()

	gzipReader, err := gzip.NewReader(archiveFile)
	if err != nil {
		return "", err
	}
	defer gzipReader.Close()

	tarReader := tar.NewReader(gzipReader)
	binDir := filepath.Dir(archivePath)
	finalBinary, err := installedBinaryPath()
	if err != nil {
		return "", err
	}

	for {
		header, err := tarReader.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return "", err
		}
		if header.Typeflag != tar.TypeReg {
			continue
		}
		name := filepath.Base(header.Name)
		if name != "clawdb-server" && name != "clawdb-server.exe" && !strings.HasPrefix(name, "clawdb-server-") {
			continue
		}

		out, err := os.Create(finalBinary)
		if err != nil {
			return "", err
		}
		if _, err := io.Copy(out, tarReader); err != nil {
			_ = out.Close()
			return "", err
		}
		if err := out.Close(); err != nil {
			return "", err
		}
		if runtime.GOOS != "windows" {
			if err := os.Chmod(finalBinary, 0o755); err != nil {
				return "", err
			}
		}
		_ = os.Remove(filepath.Join(binDir, name))
		return finalBinary, nil
	}

	return "", fmt.Errorf("downloaded archive did not contain clawdb-server binary")
}

func downloadBinary() (string, error) {
	platform, err := platformID()
	if err != nil {
		return "", err
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	binDir := filepath.Join(home, ".clawdb", "bin")
	if err := os.MkdirAll(binDir, 0o755); err != nil {
		return "", err
	}
	archiveName := fmt.Sprintf("clawdb-server-%s.tar.gz", platform)
	archivePath := filepath.Join(binDir, archiveName)
	for _, base := range releaseBaseCandidates() {
		resp, err := http.Get(fmt.Sprintf("%s/%s", base, archiveName))
		if err != nil {
			continue
		}
		if resp.StatusCode >= 400 {
			_ = resp.Body.Close()
			continue
		}
		file, err := os.Create(archivePath)
		if err != nil {
			_ = resp.Body.Close()
			return "", err
		}
		_, copyErr := io.Copy(file, resp.Body)
		closeErr := file.Close()
		_ = resp.Body.Close()
		if copyErr != nil {
			return "", copyErr
		}
		if closeErr != nil {
			return "", closeErr
		}
		return archivePath, nil
	}

	return "", fmt.Errorf("unable to locate downloadable clawdb-server release archive")
}

// resolveEndpoint settles where the client connects. An endpoint given in code
// or the environment wins. An API key with no endpoint means the hosted cloud.
// Otherwise a local clawdb-server is used, started if it is installed.
func resolveEndpoint(cfg *Config) error {
	if cfg.endpointSet {
		return nil
	}
	if cfg.APIKey != "" {
		cfg.Endpoint = CloudEndpoint
		return nil
	}
	if localServerHealthy() {
		cfg.Endpoint = "http://localhost:50050"
		return nil
	}
	if err := spawnLocalServer("clawdb-server"); err == nil && waitForLocalServer(5*time.Second) {
		return nil
	}
	if installedBinary, err := installedBinaryPath(); err == nil {
		if _, statErr := os.Stat(installedBinary); statErr == nil {
			if err := spawnLocalServer(installedBinary); err == nil && waitForLocalServer(5*time.Second) {
				return nil
			}
		}
	}
	if archivePath, err := downloadBinary(); err == nil {
		if extracted, extractErr := extractBinary(archivePath); extractErr == nil {
			if err := spawnLocalServer(extracted); err == nil && waitForLocalServer(5*time.Second) {
				return nil
			}
		}
	}
	if localServerHealthy() {
		return nil
	}
	return fmt.Errorf("could not find a server: set AXONIO_API_KEY to use the Axonio cloud, set AXONIO_URL, or start clawdb-server")
}
