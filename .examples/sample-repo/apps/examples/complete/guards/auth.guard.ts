import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';

/**
 * Simple auth guard for demonstration purposes
 */
@Injectable()
export class AuthGuard implements CanActivate {
  // Demo users - in a real app, these would be in a database
  private readonly users = [
    {
      id: 'user1',
      username: 'alice',
      email: 'alice@example.com',
      roles: ['user'],
    },
    {
      id: 'user2',
      username: 'bob',
      email: 'bob@example.com',
      roles: ['user', 'admin'],
    },
  ];

  /**
   * Validate the request and extract user information
   * @param context Execution context
   * @returns Whether the request is authorized
   */
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();

    try {
      // Extract token from Authorization header
      const token = this.extractTokenFromHeader(request);
      if (!token) {
        throw new UnauthorizedException('No token provided');
      }

      // Validate token and get user
      const user = this.validateToken(token);

      // Attach user to request
      request['user'] = user;

      return true;
    } catch (error) {
      // For demo purposes, allow test mode
      const testMode =
        request.headers['x-test-mode'] || request.headers['X-Test-Mode'];
      if (testMode === 'true') {
        console.log('Test mode enabled, bypassing authentication');
        request['user'] = this.users[0]; // Use first demo user
        return true;
      }

      throw new UnauthorizedException('Invalid token');
    }
  }

  /**
   * Extract token from Authorization header
   * @param request HTTP request
   * @returns Token or undefined
   */
  private extractTokenFromHeader(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }

  /**
   * Validate token and return user
   * @param token JWT token
   * @returns User information
   */
  private validateToken(token: string): any {
    // This is a simplified demo implementation
    // In a real app, you would use a proper JWT library

    // For demo purposes, we'll just check if the token matches a user ID
    const user = this.users.find((u) => u.id === token);
    if (!user) {
      throw new UnauthorizedException('Invalid token');
    }

    return user;
  }
}
