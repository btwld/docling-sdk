# NestJS controller snippet (S3 piping)

```ts
import { Controller, Post, Req, Res } from '@nestjs/common';
import { Docling } from 'docling-sdk';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

@Controller('convert')
export class ConvertController {
  constructor(private readonly docling: Docling) {}

  @Post('zip')
  async convertToZip(@Req() req: any, @Res() res: any) {
    // req.file.stream (Multer) or raw req as stream depending on your setup
    const filename = req.file?.originalname || 'upload.pdf';

    const result = await this.docling.convertStreamToFile(req.file.stream, filename, {
      to_formats: ['md', 'json'],
    });

    if (!result.success || !result.fileStream) {
      res.status(400).json({ error: result.error?.message || 'conversion failed' });
      return;
    }

    const s3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
    const bucket = process.env.BUCKET!;
    const key = `results/${Date.now()}-${filename}.zip`;

    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: result.fileStream }));

    res.json({ ok: true, bucket, key });
  }
}
```

