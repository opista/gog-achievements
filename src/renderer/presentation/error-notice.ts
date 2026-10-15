export interface Notice {
  message: string;
  code?: string;
}

export function toNotice(error: unknown): Notice {
  if (error instanceof Error)
    return {
      message: error.message,
      code: 'code' in error && typeof error.code === 'string' ? error.code : undefined,
    };
  return { message: 'The operation could not be completed.' };
}
