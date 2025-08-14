import { Injectable } from '@nestjs/common';

/**
 * Resource interface
 */
interface Resource {
  uri: string;
  name: string;
  mimeType?: string;
  text?: string;
  blob?: string;
}

/**
 * Service for resource-related operations
 */
@Injectable()
export class ResourceService {
  // Demo resources - in a real app, these would be in a database
  private readonly resources: Resource[] = Array.from(
    { length: 100 },
    (_, i) => {
      const uri = `mcp://example/resource/${i + 1}`;
      if (i % 2 === 0) {
        return {
          uri,
          name: `Resource ${i + 1}`,
          mimeType: 'text/plain',
          text: `Resource ${i + 1}: This is a plaintext resource`,
        };
      } else {
        const buffer = Buffer.from(`Resource ${i + 1}: This is a base64 blob`);
        return {
          uri,
          name: `Resource ${i + 1}`,
          mimeType: 'application/octet-stream',
          blob: buffer.toString('base64'),
        };
      }
    },
  );

  // Set of subscribed resource URIs
  private readonly subscriptions = new Set<string>();

  /**
   * Get all resources
   * @param startIndex Start index
   * @param pageSize Page size
   * @returns Resources and next cursor
   */
  getResources(startIndex = 0, pageSize = 10) {
    const endIndex = Math.min(startIndex + pageSize, this.resources.length);
    const resources = this.resources.slice(startIndex, endIndex);

    let nextCursor: string | undefined;
    if (endIndex < this.resources.length) {
      nextCursor = Buffer.from(endIndex.toString()).toString('base64');
    }

    return {
      resources,
      nextCursor,
    };
  }

  /**
   * Get resource by URI
   * @param uri Resource URI
   * @returns Resource or null if not found
   */
  getResourceByUri(uri: string): Resource | null {
    if (uri.startsWith('mcp://example/resource/')) {
      const index = parseInt(uri.split('/').pop() || '', 10) - 1;
      if (index >= 0 && index < this.resources.length) {
        return this.resources[index];
      }
    }
    return null;
  }

  /**
   * Subscribe to a resource
   * @param uri Resource URI
   * @returns Success status
   */
  subscribeToResource(uri: string): boolean {
    this.subscriptions.add(uri);
    return true;
  }

  /**
   * Unsubscribe from a resource
   * @param uri Resource URI
   * @returns Success status
   */
  unsubscribeFromResource(uri: string): boolean {
    return this.subscriptions.delete(uri);
  }

  /**
   * Get all subscribed resource URIs
   * @returns Set of subscribed resource URIs
   */
  getSubscriptions(): Set<string> {
    return this.subscriptions;
  }

  /**
   * Get resource templates
   * @returns Resource templates
   */
  getResourceTemplates() {
    return [
      {
        uriTemplate: 'mcp://example/resource/{id}',
        name: 'Example Resource',
        description: 'An example resource with a numeric ID',
      },
    ];
  }
}
