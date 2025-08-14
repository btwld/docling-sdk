/**
 * Base transport implementation for MCP
 */
import { JsonRpcMessage } from '../types/json-rpc.types';
import { Transport } from '../types/transport.types';

/**
 * Abstract base class for transports
 *
 * This class provides a common implementation for all transports
 */
export abstract class BaseTransport implements Transport {
  /**
   * Transport type
   */
  abstract readonly type: string;

  /**
   * Close event handler
   */
  onclose?: () => void;

  /**
   * Error event handler
   */
  onerror?: (error: Error) => void;

  /**
   * Message event handler
   */
  onmessage?: (message: JsonRpcMessage) => void;

  /**
   * Start the transport
   */
  abstract start(): Promise<void>;

  /**
   * Send a message
   *
   * @param message Message to send
   */
  abstract send(message: JsonRpcMessage): Promise<void>;

  /**
   * Close the transport
   */
  abstract close(): Promise<void>;

  /**
   * Check if the transport is running
   */
  abstract isRunning(): boolean;
}
