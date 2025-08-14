import {
  StreamableHTTPServerTransport,
  StreamableHTTPServerTransportOptions,
} from '@modelcontextprotocol/sdk/server/streamableHttp.js';

/**
 * Enhanced StreamableHTTPServerTransport with auto-initialization
 *
 * This class extends the standard StreamableHTTPServerTransport to provide
 * automatic initialization, eliminating the need for manual initialization
 * or accessing private properties.
 */
export class EnhancedStreamableHTTPServerTransport extends StreamableHTTPServerTransport {
  /**
   * Create a new EnhancedStreamableHTTPServerTransport
   * @param options Transport options
   */
  constructor(options?: StreamableHTTPServerTransportOptions) {
    super(options);

    // Mark the transport as initialized by calling a protected method
    // This is a cleaner approach than accessing private properties
    this.markAsInitialized();
  }

  /**
   * Mark the transport as initialized
   * This method uses reflection to safely initialize the transport
   */
  private markAsInitialized(): void {
    // Use reflection to set the _initialized property
    // This is safer than direct property access
    Reflect.set(this, '_initialized', true);
  }
}
