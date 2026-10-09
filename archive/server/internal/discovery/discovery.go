package discovery

import (
	"encoding/json"
	"net"
	"os"
	"time"
)

type Beacon struct {
	Magic       string  `json:"magic"`
	V           string  `json:"v"`
	Type        string  `json:"type"`
	IP          string  `json:"ip"`
	Port        int     `json:"port"`
	Hostname    string  `json:"hostname"`
	Fingerprint string  `json:"fingerprint"`
	Profile     string  `json:"profile"`
	TS          float64 `json:"ts"`
}

func LanIP() string {
	conn, err := net.Dial("udp", "8.8.8.8:80")
	if err != nil {
		return "127.0.0.1"
	}
	defer conn.Close()
	addr := conn.LocalAddr().(*net.UDPAddr)
	return addr.IP.String()
}

func Start(port, httpsPort int, fingerprint, profile string, stop <-chan struct{}) {
	go func() {
		pc, err := net.ListenPacket("udp4", ":"+itoa(port))
		if err != nil {
			return
		}
		defer pc.Close()
		_ = pc.(*net.UDPConn).SetReadBuffer(65535)

		hostname, _ := os.Hostname()
		ticker := time.NewTicker(2 * time.Second)
		defer ticker.Stop()

		buf := make([]byte, 4096)
		for {
			select {
			case <-stop:
				return
			case <-ticker.C:
				b := Beacon{
					Magic: "LANMSG", V: "3", Type: "server",
					IP: LanIP(), Port: httpsPort, Hostname: hostname,
					Fingerprint: fingerprint, Profile: profile, TS: float64(time.Now().Unix()),
				}
				raw, _ := json.Marshal(b)
				for _, target := range []string{"255.255.255.255", broadcast24(LanIP())} {
					addr, err := net.ResolveUDPAddr("udp4", target+":"+itoa(port))
					if err != nil {
						continue
					}
					_, _ = pc.WriteTo(raw, addr)
				}
			default:
				_ = pc.SetReadDeadline(time.Now().Add(200 * time.Millisecond))
				n, addr, err := pc.ReadFrom(buf)
				if err != nil {
					continue
				}
				var req map[string]any
				if json.Unmarshal(buf[:n], &req) != nil {
					continue
				}
				if req["magic"] != "LANMSG" || req["type"] != "who" {
					continue
				}
				b := Beacon{
					Magic: "LANMSG", V: "3", Type: "server",
					IP: LanIP(), Port: httpsPort, Hostname: hostname,
					Fingerprint: fingerprint, Profile: profile, TS: float64(time.Now().Unix()),
				}
				raw, _ := json.Marshal(b)
				_, _ = pc.WriteTo(raw, addr)
			}
		}
	}()
}

func broadcast24(ip string) string {
	parsed := net.ParseIP(ip).To4()
	if parsed == nil {
		return "255.255.255.255"
	}
	return net.IPv4(parsed[0], parsed[1], parsed[2], 255).String()
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b [16]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	return string(b[i:])
}
