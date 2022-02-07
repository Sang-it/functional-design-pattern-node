import bcrypt from 'bcryptjs';
import R from 'ramda';
import { pipeAsync } from 'ramda-async';
import prisma from '../../prisma/prisma-client';
import HttpException from '../models/http-exception.model';
import {
  UserQueryResponse,
  UserCreatePayload,
  UserLoginPayload,
  UserResponse,
  UserUpdatePayload,
} from '../models/user.model';
import userMapper from '../mappers/user.mapper';
import userSelector from '../selectors/user.selector';

const getUserByEmail = async (email: string) =>
  prisma.user.findUnique({
    where: {
      email,
    },
    select: userSelector,
  });

const getUserByUsername = async (username: string) =>
  prisma.user.findUnique({
    where: {
      username,
    },
    select: userSelector,
  });

const isEmailUnique = async (email: string) => R.isNil(await getUserByEmail(email));
const isUsernameUnique = async (username: string) => R.isNil(await getUserByUsername(username));

const hashString = async (key: string) => bcrypt.hash(key, 10);
const createHashedUser = async (user: UserCreatePayload | UserUpdatePayload) =>
  R.assoc('password', await hashString(R.prop('password', user)), user);

const saveUser = async (user: UserCreatePayload) =>
  prisma.user.create({
    data: {
      ...user,
    },
    select: userSelector,
  });

const updateUserDetails = R.curry(
  async (loggedInUsername: string, userPayload: UserUpdatePayload) =>
    prisma.user.update({
      where: {
        username: loggedInUsername,
      },
      data: {
        ...userPayload,
      },
      select: userSelector,
    }),
);

const checkUserUniqueness = async (
  userPayload: UserCreatePayload,
): Promise<UserCreatePayload | (UserCreatePayload & HttpException)> => {
  if ((await isEmailUnique(userPayload.email)) && (await isUsernameUnique(userPayload.username)))
    return userPayload;

  return {
    ...userPayload,
    errorCode: 422,
    message: {
      ...((await isEmailUnique(userPayload.email)) ? {} : { email: `is already taken` }),
      ...((await isUsernameUnique(userPayload.username)) ? {} : { username: `is already taken` }),
    },
  };
};

const checkNullUser = async (
  payload: UserLoginPayload,
): Promise<UserQueryResponse | (HttpException & UserQueryResponse)> =>
  pipeAsync(
    R.propOr('', 'email'),
    getUserByEmail,
    R.ifElse(
      R.isNil,
      () => ({
        name: 'HttpException',
        errorCode: 404,
        message: {
          email: 'not found',
        },
      }),
      R.identity,
    ),
  )(payload);

const checkValidPassword = R.curry(
  async (
    userPayload: UserLoginPayload,
    userResponse: UserQueryResponse,
  ): Promise<UserQueryResponse | (UserQueryResponse & HttpException)> => {
    if (await bcrypt.compare(userPayload.password, userResponse.password)) return userResponse;

    return {
      ...userResponse,
      name: 'HttpException',
      errorCode: 401,
      message: {
        password: 'is invalid',
      },
    };
  },
);

const checkUpdateUserUniqueness = async (
  userPayload: UserUpdatePayload,
): Promise<UserUpdatePayload | (UserUpdatePayload & HttpException)> => {
  if ((await isEmailUnique(userPayload.email)) && (await isUsernameUnique(userPayload.username)))
    return userPayload;

  return {
    ...userPayload,
    errorCode: 422,
    message: {
      ...((await isEmailUnique(userPayload.email)) ? {} : { email: `is already taken` }),
      ...((await isUsernameUnique(userPayload.username)) ? {} : { username: `is already taken` }),
    },
  };
};

function cleanInputGeneric<T>() {
  return (obj: Record<string, any>) =>
    R.zipObj(
      R.keys(obj),
      R.values(obj).map(val => (R.is(String, val) ? val.trim() : val)),
    ) as unknown as T;
}
const cleanUserCreatePayload = cleanInputGeneric<UserCreatePayload>();
const cleanUserLoginPayload = cleanInputGeneric<UserLoginPayload>();
const cleanUserUpdatePayload = cleanInputGeneric<UserUpdatePayload>();

function hasErrorGeneric<T>() {
  return (payload: T | (HttpException & T)): payload is HttpException & T =>
    (payload as HttpException & T).errorCode !== undefined;
}
function throwErrorGeneric<T>() {
  return (payload: T | (HttpException & T)) => {
    if (hasErrorGeneric<T>()(payload)) throw new HttpException(payload.errorCode, payload.message);
  };
}
const throwErrorUserCreatePayload = throwErrorGeneric<UserCreatePayload>();
const throwErrorUserQueryResponse = throwErrorGeneric<UserQueryResponse>();
const throwErrorUserUpdatePayload = throwErrorGeneric<UserUpdatePayload>();

export const createUser = async (userPayload: UserCreatePayload): Promise<UserResponse> =>
  pipeAsync(
    cleanUserCreatePayload,
    checkUserUniqueness,
    R.tap(throwErrorUserCreatePayload),
    createHashedUser,
    saveUser,
    userMapper,
  )(userPayload);

export const login = async (userPayload: UserLoginPayload): Promise<UserResponse> =>
  pipeAsync(
    cleanUserLoginPayload,
    checkNullUser,
    R.tap(throwErrorUserQueryResponse),
    checkValidPassword(userPayload),
    R.tap(throwErrorUserQueryResponse),
    userMapper,
  )(userPayload);

export const getCurrentUser = async (username: string): Promise<UserResponse> =>
  pipeAsync(
    getUserByUsername,
    R.ifElse(
      R.isNil,
      () => ({
        name: 'HttpException',
        errorCode: 404,
        message: {
          username: 'not found',
        },
      }),
      R.identity,
    ),
    R.tap(throwErrorUserQueryResponse),
    userMapper,
  )(username);

export const updateUser = async (
  userPayload: UserUpdatePayload,
  loggedInUsername: string,
): Promise<UserResponse> =>
  pipeAsync(
    cleanUserUpdatePayload,
    checkUpdateUserUniqueness,
    R.tap(throwErrorUserUpdatePayload),
    updateUserDetails(loggedInUsername),
    userMapper,
  )(userPayload);

export const getUserIdByUsername = async (username: string): Promise<number> =>
  pipeAsync(
    getUserByUsername,
    R.ifElse(
      R.isNil,
      () => ({
        name: 'HttpException',
        errorCode: 404,
        message: {
          username: 'not found',
        },
      }),
      R.identity,
    ),
    R.tap(throwErrorUserQueryResponse),
    R.prop('id'),
  )(username);
