import { BadRequestException, Controller, ForbiddenException, Get, HttpCode, NotFoundException, PayloadTooLargeException, Put, Query, Req, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Public } from '../common/decorators.js';
import { env } from '../config/env.js';
import { StorageService } from './storage.service.js';
import { sniffImage } from '../common/image-type.js';

const IMAGE = new Set(['image/jpeg', 'image/png', 'image/webp']);

@ApiExcludeController()
@Controller('files')
export class StorageController {
  constructor(private readonly storage: StorageService) {}

  @Public()
  @Get()
  async get(@Query('key') key: string, @Query('exp') exp: string, @Query('sig') sig: string, @Res() res: Response) {
    if (!this.storage.verify(key, Number(exp), sig)) throw new ForbiddenException('Link expired');
    if (env.storageDriver === 's3') {
      res.redirect(302, await this.storage.bucketUrl(key));
      return;
    }
    const path = this.storage.absolutePath(key);
    if (!path) throw new NotFoundException();
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.sendFile(path, { dotfiles: 'allow' });
  }

  /** Local driver: the phone PUTs a page here with the presigned link it got from /teacher/uploads/presign. */
  @Public()
  @HttpCode(200)
  @Put('upload')
  async upload(@Query('key') key: string, @Query('exp') exp: string, @Query('sig') sig: string, @Req() req: Request) {
    if (!this.storage.verify(key, Number(exp), sig, 'put')) throw new ForbiddenException('Upload link expired');
    const type = String(req.headers['content-type'] ?? '').split(';')[0];
    if (!IMAGE.has(type)) throw new BadRequestException('Only JPG, PNG or WEBP images');
    const max = env.maxUploadMb * 1024 * 1024;
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req as AsyncIterable<Buffer>) {
      size += chunk.length;
      if (size > max) throw new PayloadTooLargeException(`Max ${env.maxUploadMb} MB per page`);
      chunks.push(chunk);
    }
    if (!size) throw new BadRequestException('Empty upload');
    const body = Buffer.concat(chunks);
    if (!sniffImage(body)) throw new BadRequestException('Only JPG, PNG or WEBP images');
    await this.storage.save(key, body, type);
    return { ok: true, key, size };
  }
}
