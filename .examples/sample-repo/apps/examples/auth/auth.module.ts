import { Module } from '@nestjs/common';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { ProtectedToolProvider } from './providers/protected-tool.provider';
import { PublicToolProvider } from './providers/public-tool.provider';
import { TokenService } from './services/token.service';
import { AuthController } from './controllers/auth.controller';

/**
 * Auth module that provides authentication and tools
 */
@Module({
  providers: [
    JwtAuthGuard,
    ProtectedToolProvider,
    PublicToolProvider,
    TokenService,
  ],
  controllers: [AuthController],
  exports: [JwtAuthGuard],
})
export class AuthModule {}
