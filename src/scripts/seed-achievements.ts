import { prisma } from "../config/db.config";
import { achievementService } from "../services/achievement.service";

/**
 * Seed script to create test goals with achievements
 * Usage: tsx src/scripts/seed-achievements.ts YOUR_USER_ID
 */

async function seedAchievements(userId: string) {
  console.log(`🌱 Seeding goals ready for achievement testing`);
  console.log(`👤 User: ${userId}\n`);

  // Goals set to 1 day BEFORE each milestone
  // So next check-in will trigger achievement popup!
  const goalData = [
    { text: "Exercise daily", currentDay: 2, targetDays: 30, nextMilestone: "Day 3 - Rising Star ⭐" },
    { text: "Meditate every morning", currentDay: 6, targetDays: 60, nextMilestone: "Day 7 - Week Warrior 🗡️" },
    { text: "Read for 30 minutes", currentDay: 13, targetDays: 90, nextMilestone: "Day 14 - Fortnight Fighter ⚔️" },
    { text: "Drink 8 glasses of water", currentDay: 20, targetDays: 30, nextMilestone: "Day 21 - Habit Hero 🦸" },
    { text: "No social media before 10am", currentDay: 29, targetDays: 100, nextMilestone: "Day 30 - Month Master 👑" },
    { text: "Journal before bed", currentDay: 49, targetDays: 100, nextMilestone: "Day 50 - Legendary Streaker 🌟" },
    { text: "Practice guitar", currentDay: 99, targetDays: 150, nextMilestone: "Day 100 - Century Champion 🏆" },
    { text: "Cold shower", currentDay: 1, targetDays: 30, nextMilestone: "Day 3 - Rising Star (Comeback) 🦅" },
    { text: "Learn Spanish", currentDay: 5, targetDays: 365, nextMilestone: "Day 7 - Week Warrior 🗡️" },
    { text: "Gratitude practice", currentDay: 10, targetDays: 90, nextMilestone: "Day 14 - Fortnight Fighter ⚔️" },
  ];

  const createdGoals = [];

  for (let i = 0; i < goalData.length; i++) {
    const goalInfo = goalData[i];
    
    // Create goal
    const goal = await prisma.goal.create({
      data: {
        goalText: goalInfo.text,
        targetDays: goalInfo.targetDays,
        currentDay: goalInfo.currentDay,
        userId,
        startedAt: new Date(Date.now() - goalInfo.currentDay * 24 * 60 * 60 * 1000), // Started X days ago
        lastCheckInDate: new Date(Date.now() - 24 * 60 * 60 * 1000), // Last checked in YESTERDAY
        reminderTime: `0${8 + i}:00`.slice(-5), // Staggered reminder times
      },
    });

    console.log(`✅ Created: "${goalInfo.text}"`);
    console.log(`   Current: Day ${goalInfo.currentDay}`);
    console.log(`   Next check-in unlocks: ${goalInfo.nextMilestone}\n`);

    // Create check-ins for this goal (up to current day)
    // All check-ins should be in the past, last one YESTERDAY
    const checkIns = [];
    for (let day = 1; day <= goalInfo.currentDay; day++) {
      // Start from (currentDay + 1) days ago, so last check-in is yesterday
      const daysAgo = goalInfo.currentDay - day + 1;
      checkIns.push({
        goalId: goal.id,
        checkInDate: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000),
      });
    }

    await prisma.checkIn.createMany({
      data: checkIns,
    });

    createdGoals.push(goal);
  }

  console.log(`\n✨ Seeding complete!`);
  console.log(`📈 Created: ${createdGoals.length} goals`);
  console.log(`\n🎮 How to test:`);
  console.log(`1. Open your app`);
  console.log(`2. Go to Home screen`);
  console.log(`3. Check in on any goal`);
  console.log(`4. Watch the achievement popup! 🎉\n`);
  console.log(`💡 Tip: Use the test buttons at the top to preview different achievements`);
}

// Run the script
const userId = process.argv[2];

if (!userId) {
  console.error("❌ Error: Please provide a user ID");
  console.log("Usage: tsx src/scripts/seed-achievements.ts YOUR_USER_ID");
  process.exit(1);
}

seedAchievements(userId)
  .then(() => {
    console.log("\n✅ All done!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ Error seeding achievements:", error);
    process.exit(1);
  });
