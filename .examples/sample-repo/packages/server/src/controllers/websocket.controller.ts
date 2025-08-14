import { Controller, Logger } from '@nestjs/common';

/**
 * WebSocket controller for MCP
 * This is a placeholder controller that doesn't do anything
 * The actual WebSocket functionality is handled by the WebSocketGateway
 */
@Controller()
export class WebSocketController {
  private readonly logger = new Logger(WebSocketController.name);

  constructor() {
    this.logger.log('WebSocket controller initialized');
  }
}
