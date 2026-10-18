import { PrismaClient } from '@prisma/client'

// One client per process, shared by the API routes and the Temporal activities.
export const prisma = new PrismaClient()
