from __future__ import annotations

import httpx

from app.config import Settings


class DiscordNotifier:
    def __init__(self, settings: Settings):
        self.settings = settings

    async def send(self, content: str) -> bool:
        if not self.settings.live_discord_enabled:
            return False

        headers = {
            "Authorization": f"Bot {self.settings.discord_bot_token}",
            "Content-Type": "application/json",
        }
        async with httpx.AsyncClient(timeout=20) as client:
            dm_response = await client.post(
                "https://discord.com/api/v10/users/@me/channels",
                headers=headers,
                json={"recipient_id": str(self.settings.discord_user_id)},
            )
            dm_response.raise_for_status()
            channel_id = dm_response.json()["id"]

            message_response = await client.post(
                f"https://discord.com/api/v10/channels/{channel_id}/messages",
                headers=headers,
                json={"content": content},
            )
            message_response.raise_for_status()
        return True
