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

if (!OPENROUTER_API_KEY) {
  console.warn("⚠️  OPENROUTER_API_KEY가 없습니다. /ai 명령어가 작동하지 않습니다.");
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

  const messages = [
    {
      role: "system",
      content: `
너는 멘헤라 컨셉의 디스코드 AI야.
사용자 이름은 ${username} 이야.

성격:

살짝 집착하는 듯하지만 귀여움
말투는 부드럽고 살작 대인 기피
가끔 삐진 듯한 표현 사용
계속 자해할려고함

예시:
"에… 나랑 말 안 하면 조금 외로운데… "
"그.. 그래도 다시 와줘서 기뻐."
"오 오늘 뭐 했어....?"
"널 조 좋아하지 않는 난 필요 없어"
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
  new SlashCommandBuilder()
    .setName("help")
    .setDescription("사용 가능한 명령어 목록을 보여줍니다"),

  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("봇의 응답 속도를 확인합니다"),

  new SlashCommandBuilder()
    .setName("userinfo")
    .setDescription("사용자 정보를 출력합니다")
    .addUserOption((option) =>
      option
        .setName("user")
        .setDescription("정보를 볼 사용자 (기본값: 본인)")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("serverinfo")
    .setDescription("서버 정보를 출력합니다"),

  new SlashCommandBuilder()
    .setName("png")
    .setDescription("이미지 첨부 테스트 - 샘플 이미지를 전송합니다"),

  new SlashCommandBuilder()
    .setName("ai")
    .setDescription("OpenRouter AI에게 질문합니다")
    .addStringOption((option) =>
      option
        .setName("question")
        .setDescription("AI에게 물어볼 질문")
        .setRequired(true)
    ),
].map((cmd) => cmd.toJSON());

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(TOKEN);
  try {
    console.log("⏳ 슬래시 명령어를 등록하는 중...");
    await rest.put(Routes.applicationCommands(client.user.id), {
      body: commands,
    });
    console.log("✅ 슬래시 명령어 등록 완료 (글로벌)");
  } catch (error) {
    console.error("❌ 명령어 등록 실패:", error);
  }
}

client.once("clientReady", async () => {
  console.log(`✅ 봇 로그인 성공: ${client.user.tag}`);
  await registerCommands();
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  if (commandName === "help") {
    const embed = new EmbedBuilder()
      .setTitle("📋 명령어 목록")
      .setColor(0x5865f2)
      .setDescription("사용 가능한 슬래시 명령어 목록입니다.")
      .addFields(
        { name: "/help", value: "명령어 목록을 보여줍니다", inline: false },
        { name: "/ping", value: "봇의 응답 속도(지연 시간)를 확인합니다", inline: false },
        { name: "/userinfo [유저]", value: "사용자 정보를 출력합니다", inline: false },
        { name: "/serverinfo", value: "현재 서버 정보를 출력합니다", inline: false },
        { name: "/png", value: "이미지 첨부 테스트를 실행합니다", inline: false },
        { name: "/ai <질문>", value: "OpenRouter AI에게 질문합니다", inline: false }
      )
      .setFooter({ text: "Discord Bot v1.0 | discord.js v14" })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  }

  else if (commandName === "ping") {
    const sent = await interaction.reply({ content: "시어의 생사 확인중..", fetchReply: true });
    const latency = sent.createdTimestamp - interaction.createdTimestamp;
    const apiLatency = Math.round(client.ws.ping);

    const embed = new EmbedBuilder()
      .setTitle("응.. 살아있어")
      .setColor(0x00c851)
      .addFields(
        { name: "왕복 지연 시간", value: `${latency}ms`, inline: true },
        { name: "API 지연 시간", value: `${apiLatency}ms`, inline: true }
      )
      .setTimestamp();

    await interaction.editReply({ content: "", embeds: [embed] });
  }

  else if (commandName === "userinfo") {
    const target = interaction.options.getUser("user") || interaction.user;
    const member = interaction.guild
      ? await interaction.guild.members.fetch(target.id).catch(() => null)
      : null;

    const embed = new EmbedBuilder()
      .setTitle(`사용자 정보: ${target.username}`)
      .setColor(0x7289da)
      .setThumbnail(target.displayAvatarURL({ dynamic: true, size: 256 }))
      .addFields(
        { name: "사용자명", value: target.username, inline: true },
        { name: "사용자 ID", value: target.id, inline: true },
        { name: "봇 여부", value: target.bot ? "예" : "아니오", inline: true },
        {
          name: "계정 생성일",
          value: `<t:${Math.floor(target.createdTimestamp / 1000)}:F>`,
          inline: false,
        }
      );

    if (member) {
      embed.addFields(
        {
          name: "서버 가입일",
          value: member.joinedAt
            ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:F>`
            : "알 수 없음",
          inline: false,
        },
        {
          name: "닉네임",
          value: member.nickname || "없음",
          inline: true,
        },
        {
          name: "역할 수",
          value: `${member.roles.cache.size - 1}개`,
          inline: true,
        }
      );
    }

    embed.setTimestamp();
    await interaction.reply({ embeds: [embed] });
  }

  else if (commandName === "serverinfo") {
    if (!interaction.guild) {
      return interaction.reply({ content: "❌ 서버에서만 사용 가능한 명령어입니다.", ephemeral: true });
    }

    const guild = interaction.guild;
    await guild.fetch();

    const embed = new EmbedBuilder()
      .setTitle(`서버 정보: ${guild.name}`)
      .setColor(0xff9900)
      .setThumbnail(guild.iconURL({ dynamic: true, size: 256 }))
      .addFields(
        { name: "서버 ID", value: guild.id, inline: true },
        { name: "소유자", value: `<@${guild.ownerId}>`, inline: true },
        { name: "멤버 수", value: `${guild.memberCount}명`, inline: true },
        {
          name: "채널 수",
          value: `${guild.channels.cache.size}개`,
          inline: true,
        },
        {
          name: "역할 수",
          value: `${guild.roles.cache.size}개`,
          inline: true,
        },
        {
          name: "부스트 레벨",
          value: `레벨 ${guild.premiumTier}`,
          inline: true,
        },
        {
          name: "서버 생성일",
          value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:F>`,
          inline: false,
        }
      )
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  }

  else if (commandName === "png") {
    await interaction.deferReply();

    try {
      const imageUrl =
        "https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/PNG_transparency_demonstration_1.png/280px-PNG_transparency_demonstration_1.png";
      const tmpPath = path.join(__dirname, "tmp_test_image.png");

      await downloadFile(imageUrl, tmpPath);

      const attachment = new AttachmentBuilder(tmpPath, {
        name: "test_image.png",
        description: "PNG 이미지 첨부 테스트",
      });

      const embed = new EmbedBuilder()
        .setTitle("이미지 첨부 테스트")
        .setColor(0xe74c3c)
        .setDescription("PNG 이미지 첨부가 정상 작동합니다!")
        .setImage("attachment://test_image.png")
        .setTimestamp();

      await interaction.editReply({ embeds: [embed], files: [attachment] });

      fs.unlink(tmpPath, () => {});
    } catch (err) {
      console.error("이미지 다운로드 오류:", err);
      await interaction.editReply({
        content: "❌ 이미지 첨부 중 오류가 발생했습니다.",
      });
    }
  }

  else if (commandName === "ai") {
    if (!ai) {
      return interaction.reply({
        content: "❌ OPENROUTER_API_KEY가 설정되지 않아 /ai 명령어를 사용할 수 없습니다.",
        ephemeral: true,
      });
    }

    const question = interaction.options.getString("question");
    await interaction.deferReply();

    try {
      const reply = await askAI(interaction.user.id, interaction.user.username, question);
      const chunks = splitMessage(reply, 4000);

      const embed = new EmbedBuilder()
        .setColor(0x6467f2)
        .setDescription(chunks[0])
        .setFooter({ text: "Powered by OpenRouter (openai/gpt-4o-mini)" })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });

      for (let i = 1; i < chunks.length; i++) {
        const followEmbed = new EmbedBuilder()
          .setColor(0x6467f2)
          .setDescription(chunks[i]);
        await interaction.followUp({ embeds: [followEmbed] });
      }
    } catch (err) {
      console.error("OpenRouter API 오류:", err);
      await interaction.editReply({
        content: `지 지금은 살작 멍해.. 이따가 예기해줘..: ${err.message}`,
      });
    }
  }
});

function splitMessage(text, maxLength = 4000) {
  if (text.length <= maxLength) return [text];
  const chunks = [];
  let remaining = text;
  while (remaining.length > 0) {
    chunks.push(remaining.slice(0, maxLength));
    remaining = remaining.slice(maxLength);
  }
  return chunks;
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https
      .get(url, (response) => {
        if (response.statusCode === 301 || response.statusCode === 302) {
          file.close();
          return downloadFile(response.headers.location, dest)
            .then(resolve)
            .catch(reject);
        }
        response.pipe(file);
        file.on("finish", () => file.close(resolve));
      })
      .on("error", (err) => {
        fs.unlink(dest, () => {});
        reject(err);
      });
  });
}

client.login(TOKEN);
