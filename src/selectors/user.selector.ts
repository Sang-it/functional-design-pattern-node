import { Prisma } from '@prisma/client';

export const userSelector = Prisma.validator<Prisma.UserSelect>()({
  id: true,
  email: true,
  username: true,
  bio: true,
  password: true,
  image: true,
});

export default userSelector;
