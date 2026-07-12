"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const prisma = new client_1.PrismaClient();
const users = [
    { id: "seed-user-ava", email: "ava.seed@vybaa.local", username: "ava_seed", firstName: "Ava", lastName: "Stone" },
    { id: "seed-user-noah", email: "noah.seed@vybaa.local", username: "noah_seed", firstName: "Noah", lastName: "Vale" },
    { id: "seed-user-mia", email: "mia.seed@vybaa.local", username: "mia_seed", firstName: "Mia", lastName: "Chen" },
    { id: "seed-user-zion", email: "zion.seed@vybaa.local", username: "zion_seed", firstName: "Zion", lastName: "Cole" },
    { id: "seed-user-ivy", email: "ivy.seed@vybaa.local", username: "ivy_seed", firstName: "Ivy", lastName: "Reed" },
    { id: "seed-user-kai", email: "kai.seed@vybaa.local", username: "kai_seed", firstName: "Kai", lastName: "Grey" },
];
const communities = [
    {
        id: "seed-community-morning-builders",
        name: "Morning Builders",
        description: "Daily momentum, quiet accountability, and practical wins.",
        category: "productivity",
        ownerId: "seed-user-ava",
    },
    {
        id: "seed-community-fit-loop",
        name: "Fit Loop",
        description: "Movement goals, streak support, and friendly check-ins.",
        category: "fitness",
        ownerId: "seed-user-noah",
    },
    {
        id: "seed-community-creative-reset",
        name: "Creative Reset",
        description: "A small room for creators getting unstuck together.",
        category: "creativity",
        ownerId: "seed-user-mia",
    },
];
function daysAgo(days) {
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}
async function upsertUsers() {
    const password = await bcryptjs_1.default.hash("Password123!", 10);
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
                isPublic: true,
            },
        });
    }
}
async function upsertMemberships() {
    for (const community of communities) {
        for (const user of users) {
            const role = user.id === community.ownerId
                ? client_1.CommunityMemberRole.OWNER
                : user.id.endsWith("ivy")
                    ? client_1.CommunityMemberRole.MOD
                    : client_1.CommunityMemberRole.MEMBER;
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
        for (let index = 0; index < 3; index++) {
            const templateId = `${community.id}-template-${index + 1}`;
            const goalText = [
                "Check in before noon",
                "Share one visible progress update",
                "Complete a focused 25 minute session",
            ][index];
            await prisma.goalTemplate.upsert({
                where: { id: templateId },
                create: {
                    id: templateId,
                    communityId: community.id,
                    createdBy: users[(communityIndex + index) % users.length].id,
                    goalText,
                    targetDays: 14 + index * 7,
                    reminderTime: `${8 + index}:30`,
                    milestones: {
                        create: [
                            {
                                id: `${templateId}-milestone-1`,
                                name: "First rhythm",
                                triggerType: client_1.MilestoneTriggerType.DAY,
                                triggerValue: 3,
                                points: 10,
                                order: 1,
                            },
                            {
                                id: `${templateId}-milestone-2`,
                                name: "Momentum week",
                                triggerType: client_1.MilestoneTriggerType.DAY,
                                triggerValue: 7,
                                points: 25,
                                order: 2,
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
        for (let index = 0; index < 8; index++) {
            const actor = members[(index + communityIndex) % members.length];
            const activity = await prisma.communityActivity.create({
                data: {
                    communityId: community.id,
                    userId: actor.id,
                    type: index % 3 === 0
                        ? client_1.CommunityActivityType.GOAL_CHECK_IN
                        : index % 3 === 1
                            ? client_1.CommunityActivityType.GOAL_STARTED
                            : client_1.CommunityActivityType.TEMPLATE_CREATED,
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
                    userId: members[(index + 1) % members.length].id,
                    text: "Seeded comment: this gives the feed realistic density.",
                },
            });
        }
    }
}
async function upsertInvites() {
    for (const [index, community] of communities.entries()) {
        await prisma.communityInvite.upsert({
            where: { code: `SEED${index + 1}A` },
            create: {
                communityId: community.id,
                code: `SEED${index + 1}A`,
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
            where: { code: `MAIL${index + 1}A` },
            create: {
                communityId: community.id,
                code: `MAIL${index + 1}A`,
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
