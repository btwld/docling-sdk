import { Injectable } from '@nestjs/common';
import { Resource } from '../../lib/decorators';
import { z } from 'zod';

/**
 * Example resource provider with decorator-based capability detection
 */
@Injectable()
export class ExampleResourceProvider {
  private readonly documents = new Map<string, string>([
    ['doc1', 'This is document 1'],
    ['doc2', 'This is document 2'],
    ['doc3', 'This is document 3'],
  ]);

  /**
   * Get a document by ID
   * @param id Document ID
   * @returns The document content
   */
  @Resource({
    name: 'getDocument',
    description: 'Get a document by ID',
    uriPattern: 'document/:id',
    parameters: z.object({
      id: z.string().describe('Document ID'),
    }),
  })
  async getDocument(params: { id: string }): Promise<{ contents: { uri: string; content: string }[] }> {
    const content = this.documents.get(params.id) || 'Document not found';
    return {
      contents: [
        {
          uri: `document/${params.id}`,
          content,
        },
      ],
    };
  }

  /**
   * List all documents
   * @returns List of all documents
   */
  @Resource({
    name: 'listDocuments',
    description: 'List all documents',
    uriPattern: 'documents',
    parameters: z.object({}),
  })
  async listDocuments(): Promise<{ contents: { uri: string; title: string }[] }> {
    return {
      contents: Array.from(this.documents.entries()).map(([id, content]) => ({
        uri: `document/${id}`,
        title: `Document ${id}`,
      })),
    };
  }
}
