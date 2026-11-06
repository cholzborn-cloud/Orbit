"use server"

import "@/lib/forms/zod-de"

import { auth } from "@/lib/auth"
import { eq } from "drizzle-orm"
import { nanoid } from "nanoid"

import { db } from "@/lib/db"
import { skills } from "@/lib/db/schema"
import { brainClient } from "@/lib/brain/config"
import {
  mergeSkills,
  parseBrainSkillNames,
  skillInputSchema,
  skillNameSchema,
} from "@/lib/skills/schema"
import { listSkills as querySkills } from "@/query/skills"
import { and } from "drizzle-orm"
import { z } from "zod"

export async function listSkills() {
  const { userId } = await auth()

  try {
    return { ok: true as const, skills: await querySkills(userId) }
  } catch {
    return { ok: false as const, error: "Skills konnten nicht geladen werden." }
  }
}

export async function listSlashSkills() {
  const { userId } = await auth()

  try {
    const orbit = await querySkills(userId)
    const brainResult = await brainClient().skillsList()
    if (!brainResult.ok)
      return {
        ok: true as const,
        skills: orbit.map(({ name, description }) => ({
          name,
          description,
          source: "orbit" as const,
        })),
        brainOffline: true,
      }
    const brainNames = parseBrainSkillNames(brainResult.data)
    return {
      ok: true as const,
      skills: mergeSkills(
        orbit.map(({ name, description }) => ({
          name,
          description,
          source: "orbit" as const,
        })),
        brainNames.map((name) => ({
          name,
          description: "Brain-Skill",
          source: "brain" as const,
        }))
      ),
      brainOffline: false,
    }
  } catch {
    return { ok: false as const, error: "Skills konnten nicht geladen werden." }
  }
}

export async function getBrainSkill(input: unknown) {
  await auth()

  const parsed = skillNameSchema.safeParse(input)
  if (!parsed.success)
    return { ok: false as const, error: "Ungültiger Skill-Name." }
  const result = await brainClient().skillRead(parsed.data)
  if (!result.ok)
    return {
      ok: false as const,
      error: "Brain-Skill konnte nicht geladen werden.",
    }
  try {
    const body = result.data
    return body
      ? { ok: true as const, body: body.slice(0, 8000) }
      : {
          ok: false as const,
          error: "Brain-Skill konnte nicht geladen werden.",
        }
  } catch {
    return {
      ok: false as const,
      error: "Brain-Skill konnte nicht geladen werden.",
    }
  }
}

export async function createSkill(input: unknown) {
  const { userId } = await auth()

  const parsed = skillInputSchema.safeParse(input)
  if (!parsed.success)
    return {
      ok: false as const,
      error: "Name, Beschreibung oder Inhalt ist ungültig.",
    }
  try {
    const [skill] = await db
      .insert(skills)
      .values({ id: nanoid(), userId, ...parsed.data })
      .returning({
        id: skills.id,
        name: skills.name,
        description: skills.description,
        body: skills.body,
      })
    return { ok: true as const, skill }
  } catch {
    return {
      ok: false as const,
      error:
        "Skill konnte nicht gespeichert werden. Name möglicherweise bereits vergeben.",
    }
  }
}

export async function updateSkill(input: unknown) {
  const { userId } = await auth()

  const parsed = skillInputSchema
    .extend({ id: z.string().min(1) })
    .safeParse(input)
  if (!parsed.success || !parsed.data.id)
    return { ok: false as const, error: "Skill-Daten sind ungültig." }
  try {
    const [skill] = await db
      .update(skills)
      .set({
        name: parsed.data.name,
        description: parsed.data.description,
        body: parsed.data.body,
        updatedAt: new Date(),
      })
      .where(and(eq(skills.id, parsed.data.id), eq(skills.userId, userId)))
      .returning({
        id: skills.id,
        name: skills.name,
        description: skills.description,
        body: skills.body,
      })
    if (!skill) return { ok: false as const, error: "Skill nicht gefunden." }
    return { ok: true as const, skill }
  } catch {
    return {
      ok: false as const,
      error: "Skill konnte nicht gespeichert werden.",
    }
  }
}

export async function deleteSkill(input: unknown) {
  const { userId } = await auth()

  const parsed = z.string().min(1).safeParse(input)
  if (!parsed.success)
    return { ok: false as const, error: "Ungültiger Skill-Name." }
  try {
    const result = await db
      .delete(skills)
      .where(and(eq(skills.id, parsed.data), eq(skills.userId, userId)))
      .returning({ id: skills.id })
    return result.length
      ? { ok: true as const }
      : { ok: false as const, error: "Skill nicht gefunden." }
  } catch {
    return { ok: false as const, error: "Skill konnte nicht gelöscht werden." }
  }
}
