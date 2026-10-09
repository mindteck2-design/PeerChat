package presence

import (
	"sync"

	"github.com/gorilla/websocket"
)

type Hub struct {
	mu    sync.RWMutex
	conns map[string]map[*websocket.Conn]struct{}
}

func New() *Hub {
	return &Hub{conns: map[string]map[*websocket.Conn]struct{}{}}
}

func (h *Hub) OnlineIDs() map[string]bool {
	h.mu.RLock()
	defer h.mu.RUnlock()
	out := make(map[string]bool, len(h.conns))
	for id := range h.conns {
		out[id] = true
	}
	return out
}

func (h *Hub) Add(userID string, c *websocket.Conn) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.conns[userID] == nil {
		h.conns[userID] = map[*websocket.Conn]struct{}{}
	}
	h.conns[userID][c] = struct{}{}
}

func (h *Hub) Remove(userID string, c *websocket.Conn) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if m := h.conns[userID]; m != nil {
		delete(m, c)
		if len(m) == 0 {
			delete(h.conns, userID)
		}
	}
}

func (h *Hub) Broadcast(payload any, exclude string) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for uid, m := range h.conns {
		if uid == exclude {
			continue
		}
		for c := range m {
			_ = c.WriteJSON(payload)
		}
	}
}

func (h *Hub) SendToUsers(userIDs []string, payload any) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	set := map[string]bool{}
	for _, id := range userIDs {
		set[id] = true
	}
	for uid, m := range h.conns {
		if !set[uid] {
			continue
		}
		for c := range m {
			_ = c.WriteJSON(payload)
		}
	}
}
