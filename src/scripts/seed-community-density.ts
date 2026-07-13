import { CommunityActivityType, CommunityMemberRole, MilestoneTriggerType, PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const users = [
  { id: "seed-user-ava", email: "ava.seed@vybaa.local", username: "ava_seed", firstName: "Ava", lastName: "Stone" },
  { id: "seed-user-noah", email: "noah.seed@vybaa.local", username: "noah_seed", firstName: "Noah", lastName: "Vale" },
  { id: "seed-user-mia", email: "mia.seed@vybaa.local", username: "mia_seed", firstName: "Mia", lastName: "Chen" },
  { id: "seed-user-zion", email: "zion.seed@vybaa.local", username: "zion_seed", firstName: "Zion", lastName: "Cole" },
  { id: "seed-user-ivy", email: "ivy.seed@vybaa.local", username: "ivy_seed", firstName: "Ivy", lastName: "Reed" },
  { id: "seed-user-kai", email: "kai.seed@vybaa.local", username: "kai_seed", firstName: "Kai", lastName: "Grey" },
];

const communityProfiles = [
  ["seed-community-morning-builders", "Morning Builders", "Daily momentum, quiet accountability, and practical wins.", "productivity", "seed-user-ava"],
  ["seed-community-fit-loop", "Fit Loop", "Movement goals, streak support, and friendly check-ins.", "fitness", "seed-user-noah"],
  ["seed-community-creative-reset", "Creative Reset", "A small room for creators getting unstuck together.", "creativity", "seed-user-mia"],
  ["seed-community-night-reset", "Night Reset", "End-of-day reflection, planning, and calmer shutdowns.", "wellness", "seed-user-ivy"],
  ["seed-community-study-sprint", "Study Sprint", "Shared study blocks, exam prep, and focused accountability.", "education", "seed-user-kai"],
  ["seed-community-money-habits", "Money Habits", "Budget goals, savings streaks, and practical money check-ins.", "finance", "seed-user-zion"],
  ["seed-community-soft-life", "Soft Life Systems", "Gentle routines for people who want structure without burnout.", "lifestyle", "seed-user-mia"],
  ["seed-community-founder-focus", "Founder Focus", "Shipping, sales habits, and founder execution logs.", "business", "seed-user-ava"],
  ["seed-community-book-loop", "Book Loop", "Reading goals, chapter notes, and weekly book reflections.", "reading", "seed-user-noah"],
  ["seed-community-clean-room", "Clean Room", "Home resets, decluttering goals, and tidy-space momentum.", "home", "seed-user-ivy"],
  ["seed-community-language-lab", "Language Lab", "Daily practice, vocabulary streaks, and speaking confidence.", "learning", "seed-user-kai"],
  ["seed-community-run-club", "Run Club", "Easy runs, distance goals, and recovery-friendly consistency.", "fitness", "seed-user-noah"],
  ["seed-community-prayer-room", "Prayer Room", "Quiet spiritual rhythms, gratitude, and daily grounding.", "spirituality", "seed-user-mia"],
  ["seed-community-content-camp", "Content Camp", "Creators posting consistently and learning in public.", "creativity", "seed-user-zion"],
  ["seed-community-code-hour", "Code Hour", "Daily coding reps, project logs, and technical accountability.", "technology", "seed-user-kai"],
  ["seed-community-meal-prep", "Meal Prep Circle", "Planning, cooking, and eating with less decision fatigue.", "health", "seed-user-ava"],
  ["seed-community-art-table", "Art Table", "Sketches, practice prompts, and low-pressure creative output.", "art", "seed-user-mia"],
  ["seed-community-sleep-better", "Sleep Better", "Wind-down goals, sleep logs, and calmer nighttime routines.", "wellness", "seed-user-ivy"],
  ["seed-community-confidence-reps", "Confidence Reps", "Small social courage goals and steady self-trust practice.", "personal growth", "seed-user-zion"],
  ["seed-community-desk-reset", "Desk Reset", "Workstation cleanup, admin blocks, and productivity hygiene.", "productivity", "seed-user-noah"],
  ["seed-community-walk-and-talk", "Walk & Talk", "Walk goals with reflective prompts and casual check-ins.", "fitness", "seed-user-ava"],
  ["seed-community-weekend-build", "Weekend Build", "Two-day project pushes, tiny launches, and weekend progress.", "makers", "seed-user-kai"],
  ["seed-community-mindful-money", "Mindful Money", "Spending awareness, no-buy challenges, and saving support.", "finance", "seed-user-ivy"],
  ["seed-community-social-flexx", "Social Flexx", "Friendly public wins, progress screenshots, and group energy.", "social", "seed-user-zion"],
  ["seed-community-quiet-wins", "Quiet Wins", "Small private wins for people building without noise.", "accountability", "seed-user-noah"],
] as const;

const illustrationIds = ["orbit", "pulse", "bloom", "arc", "grid", "current"] as const;
const communities = communityProfiles.map(([id, name, description, category, ownerId], index) => ({
  category,
  coverImage: `illustration:${illustrationIds[index % illustrationIds.length]}`,
  description,
  id,
  name,
  ownerId,
}));

function daysAgo(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

async function upsertUsers() {
  const password = await bcrypt.hash("Password123!", 10);

  for (const user of users) {
    await prisma.user.upsert({
      where: { id: user.id },
      create: {
        ...user,
        password,
        isConfirmed: true,
        isFirstTime: false,
      },
      update: {
        email: user.email,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
        isConfirmed: true,
        isFirstTime: false,
      },
    });
  }
}

async function upsertCommunities() {
  for (const community of communities) {
    await prisma.community.upsert({
      where: { id: community.id },
      create: {
        ...community,
        isPublic: true,
      },
      update: {
        name: community.name,
        description: community.description,
        category: community.category,
        coverImage: community.coverImage,
        isPublic: true,
      },
    });
  }
}

async function upsertMemberships() {
  for (const community of communities) {
    for (const user of users) {
      const role =
        user.id === community.ownerId
          ? CommunityMemberRole.OWNER
          : user.id.endsWith("ivy")
            ? CommunityMemberRole.MOD
            : CommunityMemberRole.MEMBER;

      await prisma.communityMember.upsert({
        where: {
          communityId_userId: {
            communityId: community.id,
            userId: user.id,
          },
        },
        create: {
          communityId: community.id,
          userId: user.id,
          role,
          joinedAt: daysAgo(Math.floor(Math.random() * 12)),
        },
        update: { role },
      });
    }
  }
}

async function upsertTemplatesAndGoals() {
  for (const [communityIndex, community] of communities.entries()) {
    for (let index = 0; index < 4; index++) {
      const templateId = `${community.id}-template-${index + 1}`;
      const goalText = [
        "Check in before noon",
        "Share one visible progress update",
        "Complete a focused 25 minute session",
        "Reflect on one blocker and one next move",
      ][index]!;

      await prisma.goalTemplate.upsert({
        where: { id: templateId },
        create: {
          id: templateId,
          communityId: community.id,
          createdBy: users[(communityIndex + index) % users.length]!.id,
          goalText,
          targetDays: 14 + index * 7,
          reminderTime: `${8 + index}:30`,
          milestones: {
            create: [
              {
                id: `${templateId}-milestone-1`,
                name: "First rhythm",
                triggerType: MilestoneTriggerType.DAY,
                triggerValue: 3,
                points: 10,
                order: 1,
              },
              {
                id: `${templateId}-milestone-2`,
                name: "Momentum week",
                triggerType: MilestoneTriggerType.DAY,
                triggerValue: 7,
                points: 25,
                order: 2,
              },
              {
                id: `${templateId}-milestone-3`,
                name: "Sequence reward",
                triggerType: MilestoneTriggerType.SEQUENCE,
                triggerValue: 5,
                points: 20,
                sequenceBonusPoints: 10,
                order: 3,
              },
            ],
          },
        },
        update: {
          goalText,
          targetDays: 14 + index * 7,
          reminderTime: `${8 + index}:30`,
        },
      });

      for (const user of users.slice(0, 4)) {
        const goalId = `${templateId}-goal-${user.id}`;
        await prisma.goal.upsert({
          where: { id: goalId },
          create: {
            id: goalId,
            goalText,
            targetDays: 14 + index * 7,
            currentDay: Math.min(index + 2, 10),
            lastCheckInDate: daysAgo(index),
            reminderTime: `${8 + index}:30`,
            userId: user.id,
            templateId,
            communityId: community.id,
            startedAt: daysAgo(10 + index),
          },
          update: {
            currentDay: Math.min(index + 2, 10),
            lastCheckInDate: daysAgo(index),
          },
        });
      }
    }
  }
}

async function recreateActivityDensity() {
  await prisma.communityActivity.deleteMany({
    where: { metadata: { contains: "\"seed\":true" } },
  });

  for (const [communityIndex, community] of communities.entries()) {
    const members = users.slice(0, 5);

    for (let index = 0; index < 18; index++) {
      const actor = members[(index + communityIndex) % members.length]!;
      const activity = await prisma.communityActivity.create({
        data: {
          communityId: community.id,
          userId: actor.id,
          type: index % 3 === 0
            ? CommunityActivityType.GOAL_CHECK_IN
            : index % 3 === 1
              ? CommunityActivityType.GOAL_STARTED
              : CommunityActivityType.TEMPLATE_CREATED,
          metadata: JSON.stringify({
            seed: true,
            text: `Seeded activity ${index + 1} for ${community.name}`,
          }),
          createdAt: daysAgo(index % 5),
        },
      });

      for (const reactor of members.filter((member) => member.id !== actor.id).slice(0, 3)) {
        await prisma.activityReaction.upsert({
          where: {
            activityId_userId: {
              activityId: activity.id,
              userId: reactor.id,
            },
          },
          create: {
            activityId: activity.id,
            userId: reactor.id,
          },
          update: {},
        });
      }

      await prisma.activityComment.create({
        data: {
          activityId: activity.id,
          userId: members[(index + 1) % members.length]!.id,
          text: "Seeded comment: this gives the feed realistic density.",
        },
      });
    }
  }
}

async function upsertInvites() {
  for (const [index, community] of communities.entries()) {
    const inviteNumber = String(index + 1).padStart(4, "0");
    const openCode = `S${inviteNumber}A`;
    const mailCode = `M${inviteNumber}A`;

    await prisma.communityInvite.upsert({
      where: { code: openCode },
      create: {
        communityId: community.id,
        code: openCode,
        createdBy: community.ownerId,
        maxUses: -1,
      },
      update: {
        communityId: community.id,
        createdBy: community.ownerId,
        maxUses: -1,
      },
    });

    await prisma.communityInvite.upsert({
      where: { code: mailCode },
      create: {
        communityId: community.id,
        code: mailCode,
        createdBy: community.ownerId,
        inviteeEmail: `pending-${index + 1}@example.com`,
        maxUses: 1,
      },
      update: {
        inviteeEmail: `pending-${index + 1}@example.com`,
        maxUses: 1,
      },
    });
  }
}

async function main() {
  await upsertUsers();
  await upsertCommunities();
  await upsertMemberships();
  await upsertTemplatesAndGoals();
  await recreateActivityDensity();
  await upsertInvites();

  console.log("Seeded community density data.");
  console.log("Seed user password: Password123!");
}

main()
  .catch((error) => {
    console.error("Community density seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
