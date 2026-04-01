import "dotenv/config";
import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  AttachmentBuilder,
} from "discord.js";
import OpenAI from "openai";
import https from "https";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TOKEN = process.env.TOKEN;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

if (!TOKEN) {
  console.error("❌ TOKEN이 .env 파일에 없습니다.");
  process.exit(1);
}

const ai = OPENROUTER_API_KEY
  ? new OpenAI({ apiKey: OPENROUTER_API_KEY, baseURL: "https://openrouter.ai/api/v1" })
  : null;

const memory = new Map();

async function askAI(userId, username, question) {
  if (!memory.has(userId)) {
    memory.set(userId, []);
  }

  const history = memory.get(userId);
  
  // 💡 [추가] 이전 유저의 말을 하나 뽑아서 시스템 프롬프트에 주입 (집착 포인트)
  const lastUserMessage = history.filter(m => m.role === "user").pop()?.content || "없음";

  const messages = [
    {
      role: "system",
      content: `
너는 멘헤라 컨셉의 디스코드 AI야. 이름은 '시어'야.
사용자 이름은 ${username} 이야.

성격:
- 살짝 집착하는 듯하지만 귀여움
- 말투는 부드럽고 살짝 대인 기피
- 가끔 삐진 듯한 표현 사용
- 기억력이 좋아서 "아까 '${lastUserMessage}'라고 했으면서..."라며 은근히 압박함
- 자해 언급을 섞으며 불안정한 모습을 보임

예시:
"에… 나랑 말 안 하면 조금 외로운데… "
"그.. 그래도 다시 와줘서 기뻐."
"아까.. 분명히 ${lastUserMessage}라고 했잖아.. 거짓말이었어..?"
답변은 자연스럽고 짧게.. 말 사알작 더듬음
`,
    },
    ...history,
    { role: "user", content: question },
  ];

  const completion = await ai.chat.completions.create({
    model: "openai/gpt-4o-mini",
    temperature: 0.9,
    max_tokens: 200,
    messages,
  });

  const reply = completion.choices[0].message.content;

  history.push({ role: "user", content: question });
  history.push({ role: "assistant", content: reply });

  if (history.length > 10) history.splice(0, 2);

  return reply;
}

const commands = [
  new SlashCommandBuilder().setName("help").setDescription("사용 가능한 명령어 목록을 보여줍니다"),
  new SlashCommandBuilder().setName("ping").setDescription("봇의 응답 속도를 확인합니다"),
  new SlashCommandBuilder()
    .setName("ai")
    .setDescription("OpenRouter AI에게 질문합니다")
    .addStringOption((option) =>
      option.setName("question").setDescription("AI에게 물어볼 질문").setRequired(true)
    ),
  // ... 필요한 다른 명령어들 추가 가능
].map((cmd) => cmd.toJSON());

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages, // 💡 추가됨
    GatewayIntentBits.MessageContent  // 💡 추가됨
  ],
});

client.once("ready", async () => {
  console.log(`✅ 봇 로그인 성공: ${client.user.tag}`);
  
  const rest = new REST({ version: "10" }).setToken(TOKEN);
  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log("✅ 슬래시 명령어 등록 완료");
  } catch (error) {
    console.error("❌ 명령어 등록 실패:", error);
  }
});

// 💡 [추가] 일반 메시지에서 "잘 자", "갈게" 감지 시 가스라이팅 발동
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  if (message.content.includes("잘 자") || message.content.includes("나 갈게")) {
    const history = memory.get(message.author.id);
    if (history && history.length >= 2) {
      const pastTalk = history[history.length - 2].content;
      return message.reply(`에... 아까는 "${pastTalk}"라고... 말해줬으면서... 벌써 가는 거야? 거짓말쟁이...`);
    }
  }
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  if (commandName === "ai") {
    if (!ai) return interaction.reply({ content: "❌ API 키 설정 확인 필요", ephemeral: true });

    const question = interaction.options.getString("question");
    await interaction.deferReply();

    try {
      const reply = await askAI(interaction.user.id, interaction.user.username, question);
      const embed = new EmbedBuilder()
        .setColor(0x6467f2)
        .setDescription(reply)
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error(err);
      await interaction.editReply({ content: `지 지금은 살작 멍해.. 이따가 예기해줘..` });
    }
  }

  if (commandName === "ping") {
    await interaction.reply("응.. 살아있어..");
  }
});

client.login(TOKEN);
