require('dotenv').config();
const axios = require('axios');
const { Client, GatewayIntentBits, EmbedBuilder, ActivityType } = require('discord.js');

/* ================= CONFIG ================= */
const {
  DISCORD_TOKEN: TOKEN,
  STATUS_CHANNEL_ID: CHANNEL_ID,
  ALERT_ROLE_ID: ROLE_ID,
  API_URL_ROBLOX: API_URL
} = process.env;

const INTERVAL = 60_000; // 1 menit

/* ================= CLIENT ================= */
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
});

/* ================= MEMORY ================= */
const pingedIncidents = new Set();
const pingedMaintenances = new Set();

/* ================= UTILS ================= */
const formatTimestamp = (date) => `<t:${Math.floor(new Date(date).getTime() / 1000)}:F>`;

const emoji = (status = '') => {
  const s = status.toLowerCase();
  if (s.includes('operational')) return '🟢';
  if (s.includes('degraded')) return '🟡';
  if (s.includes('partial')) return '🟠';
  return '🔴';
};

const statusColor = (status = '', code = 0) => {
  const s = status.toLowerCase();
  if (s.includes('operational') || code === 100) return 0x2ecc71;
  if (s.includes('degraded') || code === 200) return 0xf1c40f;
  if (s.includes('partial') || code === 300) return 0xe67e22;
  return 0xe74c3c;
};

/* ================= EMBEDS ================= */
const buildEmbeds = (result) => {
  const embeds = [];

  // OVERALL STATUS
  const { status_overall } = result;
  embeds.push(
    new EmbedBuilder()
      .setTitle('📊 Roblox System Status (Realtime)')
      .setColor(statusColor(status_overall?.status, status_overall?.status_code))
      .setDescription(`${emoji(status_overall?.status)} **${status_overall?.status}**\nUpdated ${formatTimestamp(status_overall?.updated)}`)
      .setFooter({ text: 'Last Update' })
      .setTimestamp()
  );

  // SERVICES
  let serviceEmbed = new EmbedBuilder()
    .setTitle('🧩 Services')
    .setColor(statusColor(status_overall?.status))
    .setFooter({ text: 'Last Update' })
    .setTimestamp();

  let count = 0;
  for (const svc of result.status || []) {
    serviceEmbed.addFields({
      name: `🔹 ${svc.name}`,
      value: svc.containers.map(c => `• ${c.name} — ${emoji(c.status)} ${c.status}`).join('\n') || '-',
      inline: false
    });

    count++;
    if (count === 3) {
      embeds.push(serviceEmbed);
      serviceEmbed = new EmbedBuilder()
        .setTitle('🧩 Services (cont.)')
        .setColor(statusColor(status_overall?.status))
        .setFooter({ text: 'Last Update' })
        .setTimestamp();
      count = 0;
    }
  }
  if (count > 0) embeds.push(serviceEmbed);

  // INCIDENTS
  const incidents = result.incidents || [];
  if (incidents.length === 0) {
    embeds.push(
      new EmbedBuilder()
        .setTitle('🚨 Active Incident')
        .setColor(0x2ecc71)
        .setDescription('🟢 No active incidents')
        .setFooter({ text: 'Last Update' })
        .setTimestamp()
    );
  } else {
    for (const inc of incidents) {
      let desc = `**${inc.name}**\nIncident Status: ${inc.current_active ? 'Active' : 'Resolved'}\n\n`;
      desc += `**Components**: ${inc.components_affected?.map(c => c.name).join(', ') || '-'}\n\n`;
      desc += `**Locations**: ${inc.containers_affected?.map(c => c.name).join(', ') || '-'}\n\n`;

      for (const msg of inc.messages || []) {
        const label = /operational|resolved/i.test(msg.details || '') ? 'IDENTIFIED' : 'INVESTIGATING';
        desc += `${formatTimestamp(msg.datetime)} — ${label}\n${msg.details}\n\n`;
      }

      embeds.push(
        new EmbedBuilder()
          .setTitle('🚨 Active Incident')
          .setColor(inc.current_active ? 0xe74c3c : 0x2ecc71)
          .setDescription(desc)
          .setFooter({ text: 'Last Update' })
          .setTimestamp()
      );
    }
  }

  // MAINTENANCE
  const { maintenance: m = { active: [], upcoming: [] } } = result;
  let mDesc = '';
  if (m.active.length === 0 && m.upcoming.length === 0) mDesc = '🟢 No active or upcoming maintenance.';
  else {
    if (m.active.length > 0) mDesc += `**Active Maintenance**\n${m.active.map(a => `• ${a.name}`).join('\n')}\n\n`;
    if (m.upcoming.length > 0) mDesc += `**Upcoming Maintenance**\n${m.upcoming.map(u => `• ${u.name}`).join('\n')}`;
  }

  embeds.push(
    new EmbedBuilder()
      .setTitle('🛠️ Maintenance')
      .setColor(m.active.length > 0 ? 0xe67e22 : 0x3498db)
      .setDescription(mDesc)
      .setFooter({ text: 'Last Update' })
      .setTimestamp()
  );

  return embeds;
};

/* ================= REALTIME LOOP ================= */
let statusMessage = null;

async function updateStatus() {
  try {
    const channel = await client.channels.fetch(CHANNEL_ID);
    const { data } = await axios.get(API_URL);
    const { result } = data;

    const embeds = buildEmbeds(result);

    // INCIDENT PINGS
    (result.incidents || []).forEach(async (inc) => {
      if (!inc.current_active) return pingedIncidents.delete(inc.id);
      const lastMsg = inc.messages?.[inc.messages.length - 1];
      if (!lastMsg) return;
      const detail = (lastMsg.details || '').toLowerCase();
      if (/operational|resolved/.test(detail)) return;
      if (!pingedIncidents.has(inc.id)) {
        await channel.send({ content: `🚨 <@&${ROLE_ID}> **Incident baru terdeteksi:** ${inc.name}` });
        pingedIncidents.add(inc.id);
      }
    });

    // MAINTENANCE PINGS
    (result.maintenance?.active || []).forEach(async (m) => {
      if (!pingedMaintenances.has(m.id)) {
        await channel.send({ content: `🛠️ <@&${ROLE_ID}> **Maintenance aktif dimulai:** ${m.name}` });
        pingedMaintenances.add(m.id);
      }
    });

    // RESET MAINTENANCE
    const activeIds = new Set((result.maintenance?.active || []).map(m => m.id));
    [...pingedMaintenances].forEach(id => { if (!activeIds.has(id)) pingedMaintenances.delete(id); });

    // SEND OR UPDATE STATUS MESSAGE
    if (!statusMessage) {
      const msgs = await channel.messages.fetch({ limit: 1 });
      statusMessage = msgs.first() || await channel.send({ embeds });
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
  client.user.setPresence({
    activities: [{ name: 'Roblox Status', type: ActivityType.Watching }],
    status: 'online'
  });

  await updateStatus();
  setInterval(updateStatus, INTERVAL);
});

client.login(TOKEN);