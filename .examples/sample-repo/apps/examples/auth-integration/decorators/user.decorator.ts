import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * User decorator
 * This decorator extracts the user from the request
 */
export const User = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
