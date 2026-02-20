import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server } from 'socket.io';

const ORIGINS = (process.env.WEB_ORIGINS ?? 'http://localhost:3000')
  .split(',')
  .map((s) => s.trim());

@WebSocketGateway({
  cors: {
    origin: ORIGINS,
    credentials: true,
  },
})
export class TelemetryGateway {
  @WebSocketServer()
  server!: Server;

  broadcastTelemetry(deviceId: string, data: any) {
    this.server.emit(`device:${deviceId}`, data);
  }

  broadcastAlert(deviceId: string, data: any) {
    console.log('WS broadcastAlert ->', `device:${deviceId}:alert`, data);
    this.server.emit(`device:${deviceId}:alert`, data);
  }

  broadcastAlertAck(deviceId: string, alertId: string) {
    this.server.emit(`device:${deviceId}:alert:ack`, { id: alertId, deviceId });
  }
}
