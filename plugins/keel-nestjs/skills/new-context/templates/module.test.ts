import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { expect, it } from 'vitest';
import { {{Name}}Module } from './{{name}}.module.js';

it('the {{name}} module compiles with the real container', async () => {
  const moduleRef = await Test.createTestingModule({ imports: [{{Name}}Module] }).compile();
  expect(moduleRef.get({{Name}}Module)).toBeInstanceOf({{Name}}Module);
  await moduleRef.close();
});
