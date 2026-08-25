"""Per-user fan-out so a tick on your phone lands on your laptop immediately.

Sockets are grouped by user id, and a mutation is echoed to every socket that
user has open except the one that caused it. State lives in this process, which
is right for a single Render instance; a multi-instance deploy would swap the
dict for a Redis pub/sub channel keyed the same way.
"""

import asyncio
import uuid
from collections.abc import Iterable

from fastapi import WebSocket


class ConnectionManager:
    def __init__(self) -> None:
        # user id -> { socket: client id }. The browser WebSocket API cannot set
        # request headers, so each tab announces its client id in the query
        # string and it is remembered here for the life of the connection.
        self._rooms: dict[uuid.UUID, dict[WebSocket, str]] = {}
        self._lock = asyncio.Lock()

    async def connect(
        self, user_id: uuid.UUID, socket: WebSocket, client_id: str
    ) -> None:
        await socket.accept()
        async with self._lock:
            self._rooms.setdefault(user_id, {})[socket] = client_id

    async def disconnect(self, user_id: uuid.UUID, socket: WebSocket) -> None:
        async with self._lock:
            room = self._rooms.get(user_id)
            if room is None:
                return
            room.pop(socket, None)
            if not room:
                self._rooms.pop(user_id, None)

    async def broadcast(
        self, user_id: uuid.UUID, message: dict, exclude: str | None = None
    ) -> None:
        async with self._lock:
            targets = list(self._rooms.get(user_id, {}).items())
        if not targets:
            return

        payload = {**message, "origin": exclude}
        dead: list[WebSocket] = []
        for socket, client_id in targets:
            # The originating tab already applied the change optimistically, so
            # echoing it back would only fight its own local state.
            if exclude is not None and client_id == exclude:
                continue
            try:
                await socket.send_json(payload)
            except Exception:
                dead.append(socket)

        for socket in dead:
            await self.disconnect(user_id, socket)

    async def broadcast_many(
        self,
        user_ids: Iterable[uuid.UUID],
        message: dict,
        exclude: str | None = None,
    ) -> None:
        """Fan one payload out to several people at once.

        Group chat rides the same per-user sockets as habit sync, so a member
        hears a new message wherever they are in the app rather than only while
        the chat happens to be open.
        """
        for user_id in set(user_ids):
            await self.broadcast(user_id, message, exclude=exclude)

    def connection_count(self, user_id: uuid.UUID) -> int:
        return len(self._rooms.get(user_id, {}))

    def is_online(self, user_id: uuid.UUID) -> bool:
        return bool(self._rooms.get(user_id))


manager = ConnectionManager()
