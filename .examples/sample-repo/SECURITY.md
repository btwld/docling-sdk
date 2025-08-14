# Security Policy

## Supported Versions

We actively support the following versions of NestJS MCP packages:

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

## Reporting a Vulnerability

We take security vulnerabilities seriously. If you discover a security vulnerability in any of our packages, please report it to us privately.

### How to Report

1. **Do not** create a public GitHub issue for security vulnerabilities
2. Email us at: [security@nest-mind.com](mailto:security@nest-mind.com)
3. Include the following information:
   - Package name and version affected
   - Description of the vulnerability
   - Steps to reproduce the issue
   - Potential impact
   - Any suggested fixes (if available)

### What to Expect

- **Acknowledgment**: We will acknowledge receipt of your report within 48 hours
- **Initial Assessment**: We will provide an initial assessment within 5 business days
- **Updates**: We will keep you informed of our progress
- **Resolution**: We aim to resolve critical vulnerabilities within 30 days

### Disclosure Policy

- We will work with you to understand and resolve the issue
- We will credit you in our security advisory (unless you prefer to remain anonymous)
- We will coordinate the disclosure timeline with you
- We will publish a security advisory after the fix is released

### Security Best Practices

When using NestJS MCP packages:

1. **Keep Dependencies Updated**: Regularly update to the latest versions
2. **Validate Input**: Always validate and sanitize user inputs
3. **Use HTTPS**: Ensure all communications use secure protocols
4. **Authentication**: Implement proper authentication and authorization
5. **Rate Limiting**: Implement rate limiting for your MCP endpoints
6. **Monitoring**: Monitor your applications for suspicious activity

### Security Features

Our packages include several security features:

- **Input Validation**: Built-in Zod schema validation
- **Authentication Support**: JWT-based authentication
- **Transport Security**: Support for secure transport protocols
- **Error Handling**: Secure error handling that doesn't leak sensitive information

## Contact

For security-related questions or concerns, please contact:
- Email: [security@nest-mind.com](mailto:security@nest-mind.com)
- GitHub: [@nest-mind](https://github.com/nest-mind)

Thank you for helping keep NestJS MCP secure!
