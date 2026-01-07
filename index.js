require('dotenv').config();
const axios = require('axios');
const {
  Client,
  GatewayIntentBits,
  EmbedBuilder
} = require('discord.js');

/* ================= CONFIG ================= */

const TOKEN = process.env.DISCORD_TOKEN;
const CHANNEL_ID = process.env.STATUS_CHANNEL_ID;
const ROLE_ID = process.env.ALERT_ROLE_ID;

const API_URL = process.env.API_URL_ROBLOX;

const INTERVAL = 60 * 1000;

/* ================= CLIENT ================= */

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages
  ]
});

/* ================= MEMORY ================= */

const pingedIncidents = new Set();
const pingedMaintenances = new Set();

/* ================= UTIL ================= */

const ts = d =>
  `<t:${Math.floor(new Date(d).getTime() / 1000)}:F>`;

function emoji(status = '') {
  status = status.toLowerCase();
  if (status.includes('operational')) return '🟢';
  if (status.includes('degraded')) return '🟡';
  if (status.includes('partial')) return '🟠';
  return '🔴';
}

function statusColor(status = '', code = 0) {
  status = status.toLowerCase();
  if (status.includes('operational') || code === 100) return 0x2ECC71;
  if (status.includes('degraded') || code === 200) return 0xF1C40F;
  if (status.includes('partial') || code === 300) return 0xE67E22;
  return 0xE74C3C;
}

/* ================= EMBEDS ================= */

function buildEmbeds(result) {
  const embeds = [];

  /* ===== OVERALL ===== */
  embeds.push(
    new EmbedBuilder()
      .setTitle('📊 Roblox System Status (Realtime)')
      .setColor(
        statusColor(
          result.status_overall?.status,
          result.status_overall?.status_code
        )
      )
      .setDescription(
        `${emoji(result.status_overall?.status)} **${result.status_overall?.status}**\nUpdated ${ts(result.status_overall?.updated)}`
      )
      .setFooter({ text: `Last Update `})
      .setTimestamp()
  );

  /* ===== SERVICES ===== */
  let svc = new EmbedBuilder()
    .setTitle('🧩 Services')
    .setColor(statusColor(result.status_overall?.status))
    .setFooter({ text: `Last Update`})
    .setTimestamp();

  let count = 0;

  for (const s of result.status || []) {
    svc.addFields({
      name: `🔹 ${s.name}`,
      value: s.containers
        .map(c => `• ${c.name} — ${emoji(c.status)} ${c.status}`)
        .join('\n'),
      inline: false
    });

    count++;
    if (count === 3) {
      embeds.push(svc);
      svc = new EmbedBuilder()
        .setTitle('🧩 Services (cont.)')
        .setColor(statusColor(result.status_overall?.status))
        .setFooter({ text: `Last Update`})
        .setTimestamp();
      count = 0;
    }
  }

  if (count > 0) embeds.push(svc);

  /* ===== INCIDENT ===== */
  if (result.incidents?.length > 0) {
    for (const inc of result.incidents) {
      let desc = '';

      desc += `**${inc.name}**\n`;
      desc += `Incident Status\n`;
      desc += `${inc.current_active ? 'Active' : 'Resolved'}\n\n`;

      desc += `**Components**\n`;
      desc += inc.components_affected?.map(c => c.name).join(', ') || '-';
      desc += `\n\n`;

      desc += `**Locations**\n`;
      desc += inc.containers_affected?.map(c => c.name).join(', ') || '-';
      desc += `\n\n`;

      for (const msg of inc.messages || []) {
        const label =
          msg.details?.toLowerCase().includes('operational') ||
          msg.details?.toLowerCase().includes('resolved')
            ? 'IDENTIFIED'
            : 'INVESTIGATING';

        desc += `${ts(msg.datetime)}\n`;
        desc += `${label}\n\n`;
        desc += `${msg.details}\n\n`;
      }

      embeds.push(
        new EmbedBuilder()
          .setTitle('🚨 Active Incident')
          .setColor(
            inc.current_active ? 0xE74C3C : 0x2ECC71
          )
          .setDescription(desc)
          .setFooter({ text: `Last Update`})
          .setTimestamp()
      );
    }
  } else {
    embeds.push(
      new EmbedBuilder()
        .setTitle('🚨 Active Incident')
        .setColor(0x2ECC71)
        .setDescription('🟢 No active incidents')
        .setFooter({ text: `Last Update`})
        .setTimestamp()
    );
  }

  /* ===== MAINTENANCE ===== */
  const m = result.maintenance || { active: [], upcoming: [] };
  let mDesc = '';

  if (m.active.length === 0 && m.upcoming.length === 0) {
    mDesc = '🟢 No active or upcoming maintenance.';
  } else {
    if (m.active.length > 0) {
      mDesc += `**Active Maintenance**\n`;
      for (const a of m.active) {
        mDesc += `• ${a.name}\n`;
      }
      mDesc += '\n';
    }

    if (m.upcoming.length > 0) {
      mDesc += `**Upcoming Maintenance**\n`;
      for (const u of m.upcoming) {
        mDesc += `• ${u.name}\n`;
      }
    }
  }

  embeds.push(
    new EmbedBuilder()
      .setTitle('🛠️ Maintenance')
      .setColor(m.active.length > 0 ? 0xE67E22 : 0x3498DB)
      .setDescription(mDesc)
      .setFooter({ text: `Last Update`})
      .setTimestamp()
  );

  return embeds;
}

/* ================= REALTIME LOOP ================= */

let statusMessage = null;

async function updateStatus() {
  try {
    const channel = await client.channels.fetch(CHANNEL_ID);
    const { data } = await axios.get(API_URL);
    const result = data.result;

    const embeds = buildEmbeds(result);

    /* ===== INCIDENT PING PER ID ===== */
    for (const inc of result.incidents || []) {
      if (!inc.current_active) {
        pingedIncidents.delete(inc.id);
        continue;
      }

      const lastMsg = inc.messages?.[inc.messages.length - 1];
      if (!lastMsg) continue;

      const detail = lastMsg.details?.toLowerCase() || '';
      if (detail.includes('operational') || detail.includes('resolved')) continue;

      if (!pingedIncidents.has(inc.id)) {
        await channel.send({
          content: `🚨 <@&${ROLE_ID}> **Incident baru terdeteksi:** ${inc.name}`
        });
        pingedIncidents.add(inc.id);
      }
    }

    /* ===== MAINTENANCE PING PER ID ===== */
    for (const m of result.maintenance?.active || []) {
      if (!pingedMaintenances.has(m.id)) {
        await channel.send({
          content: `🛠️ <@&${ROLE_ID}> **Maintenance aktif dimulai:** ${m.name}`
        });
        pingedMaintenances.add(m.id);
      }
    }

    /* ===== RESET MAINTENANCE ===== */
    const activeIds = new Set(
      (result.maintenance?.active || []).map(m => m.id)
    );
    for (const id of [...pingedMaintenances]) {
      if (!activeIds.has(id)) pingedMaintenances.delete(id);
    }

    if (!statusMessage) {
      const msgs = await channel.messages.fetch({ limit: 1 });
      statusMessage = msgs.first();
      if (!statusMessage) {
        statusMessage = await channel.send({ embeds });
      }
    }

    await statusMessage.edit({ embeds });
    console.log('🔄 Status updated');
  } catch (err) {
    console.error('❌ Update failed:', err.message);
  }
}

/* ================= READY ================= */

client.once('ready', async () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);
  await updateStatus();
  setInterval(updateStatus, INTERVAL);
});

client.login(TOKEN);
