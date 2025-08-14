import { Controller, Get, Post, Body, UnauthorizedException } from '@nestjs/common';
import { TokenService } from '../services/token.service';

/**
 * Controller for authentication endpoints
 */
@Controller('auth')
export class AuthController {
  constructor(private readonly tokenService: TokenService) {}

  /**
   * Login endpoint
   * @param body Request body
   * @returns Token
   */
  @Post('login')
  login(@Body() body: { username: string; password: string }) {
    // In a real app, we would validate the password
    // For this demo, we'll accept any password
    
    const token = this.tokenService.getTokenForUser(body.username);
    if (!token) {
      throw new UnauthorizedException('Invalid username');
    }
    
    return { token };
  }

  /**
   * Get users endpoint
   * @returns List of users
   */
  @Get('users')
  getUsers() {
    return {
      users: this.tokenService.getAllUsers(),
    };
  }
}
