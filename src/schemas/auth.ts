import { z } from 'zod';

const email = z
  .string()
  .trim()
  .min(1, 'Informe o e-mail')
  .max(254, 'E-mail muito longo')
  .email('E-mail inválido');

export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Informe a senha'),
});

export const registerSchema = z
  .object({
    name: z.string().trim().min(2, 'Informe seu nome').max(80, 'Máximo de 80 caracteres'),
    email,
    password: z
      .string()
      .min(6, 'Use pelo menos 6 caracteres')
      .max(200, 'Máximo de 200 caracteres')
      .refine((v) => /\S/.test(v), 'A senha não pode ter só espaços'),
    confirm: z.string().min(1, 'Confirme a senha'),
  })
  .refine((data) => data.password === data.confirm, {
    message: 'As senhas não conferem',
    path: ['confirm'],
  });

export type LoginData = z.infer<typeof loginSchema>;
export type RegisterData = z.infer<typeof registerSchema>;
