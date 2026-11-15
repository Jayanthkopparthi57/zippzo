from channels.generic.websocket import AsyncJsonWebsocketConsumer


class UserEventsConsumer(AsyncJsonWebsocketConsumer):
    """Deliver private notification events to the authenticated user's apps."""

    async def connect(self):
        user = self.scope.get('user')
        if user is None:
            await self.close(code=4401)
            return
        self.group_name = f'user-events-{user.user_id}'
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept(subprotocol='zippzo.events.v1')

    async def disconnect(self, close_code):
        group_name = getattr(self, 'group_name', None)
        if group_name:
            await self.channel_layer.group_discard(group_name, self.channel_name)

    async def notification_event(self, event):
        await self.send_json({'type': 'notification', 'notification': event['notification']})
