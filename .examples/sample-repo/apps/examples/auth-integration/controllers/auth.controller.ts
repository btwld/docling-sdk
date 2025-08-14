import { Controller, Post, Body, Get, UseGuards } from '@nestjs/common';
import { AuthService } from '../services/auth.service';
import { UsersService } from '../services/users.service';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { User } from '../decorators/user.decorator';

/**
 * Authentication controller
 * This controller handles authentication endpoints
 */
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly usersService: UsersService,
  ) {}

  /**
   * Login endpoint
   * @param loginDto Login DTO
   * @returns JWT token
   */
  @Post('login')
  async login(@Body() loginDto: { username: string; password: string }) {
    const user = await this.authService.validateUser(
      loginDto.username,
      loginDto.password,
    );
    return this.authService.login(user);
  }

  /**
   * Get current user endpoint
   * @param user User object from JWT
   * @returns User object
   */
  @UseGuards(JwtAuthGuard)
  @Get('profile')
  getProfile(@User() user: any) {
    return user;
  }

  /**
   * Get all users endpoint
   * @returns Array of users
   */
  @Get('users')
  async getUsers() {
    return {
      users: await this.usersService.findAll(),
    };
  }
}
