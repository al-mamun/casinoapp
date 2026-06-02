require('dotenv').config();
const bcrypt = require('bcryptjs');
const sequelize = require('../config/sequelize.db');
const {
    User, Wallet, Role, League, Match, Market, Bet, Transaction,
    DepositRequest, WithdrawRequest, BankingMethod, Message,
    Commission, PlayerStats, Result, Notification, SystemSettings, AuditLog
} = require('../models');

async function seedSampleData() {
    try {
        await sequelize.authenticate();
        console.log('DB Connected');
        await sequelize.sync({ alter: true });
        console.log('Tables synced');

        const hash = async (pw) => await bcrypt.hash(pw, 10);

        // ==================== 1. USERS (Full Hierarchy) ====================
        console.log('Creating users...');

        const owner = await User.findOne({ where: { username: 'owner' } });

        // Mother Panel
        const [mother] = await User.findOrCreate({ where: { username: 'mother_panel1' }, defaults: {
            password: await hash('123456'), role: 'MOTHER_PANEL', roleId: 2, parentId: owner.id,
            fullName: 'Karim Uddin', phone: '01711111111', email: 'mother@betx365.com', status: 'active', referralCode: 'MOP-001'
        }});

        // White Label
        const [whitelabel] = await User.findOrCreate({ where: { username: 'whitelabel1' }, defaults: {
            password: await hash('123456'), role: 'WHITE_LABEL', roleId: 3, parentId: mother.id,
            fullName: 'Rahim Khan', phone: '01722222222', email: 'wl@betx365.com', status: 'active', referralCode: 'WL-001'
        }});

        // Super Admin
        const [superAdmin] = await User.findOrCreate({ where: { username: 'superadmin1' }, defaults: {
            password: await hash('123456'), role: 'SUPER_ADMIN', roleId: 4, parentId: whitelabel.id,
            fullName: 'Jamal Hossain', phone: '01733333333', status: 'active', referralCode: 'SA-001'
        }});

        // Admin
        const [admin] = await User.findOrCreate({ where: { username: 'admin1' }, defaults: {
            password: await hash('123456'), role: 'ADMIN', roleId: 5, parentId: superAdmin.id,
            fullName: 'Shakil Ahmed', phone: '01744444444', status: 'active', referralCode: 'AD-001'
        }});

        // B2C Sub Admin
        const [b2cSub] = await User.findOrCreate({ where: { username: 'b2c_sub1' }, defaults: {
            password: await hash('123456'), role: 'B2C_SUB_ADMIN', roleId: 6, parentId: admin.id,
            fullName: 'Faruk Islam', phone: '01755555555', status: 'active', referralCode: 'B2C-001'
        }});

        // Senior Affiliate
        const [srAffiliate] = await User.findOrCreate({ where: { username: 'sr_affiliate1' }, defaults: {
            password: await hash('123456'), role: 'SENIOR_AFFILIATE', roleId: 7, parentId: b2cSub.id,
            fullName: 'Nasir Uddin', phone: '01766666666', status: 'active', referralCode: 'SRA-001'
        }});

        // Affiliate
        const [affiliate] = await User.findOrCreate({ where: { username: 'affiliate1' }, defaults: {
            password: await hash('123456'), role: 'AFFILIATE', roleId: 8, parentId: srAffiliate.id,
            fullName: 'Rony Mia', phone: '01777777777', status: 'active', referralCode: 'AFF-001'
        }});

        // B2B Sub Admin
        const [b2bSub] = await User.findOrCreate({ where: { username: 'b2b_sub1' }, defaults: {
            password: await hash('123456'), role: 'B2B_SUB_ADMIN', roleId: 9, parentId: admin.id,
            fullName: 'Tanvir Rahman', phone: '01788888888', status: 'active', referralCode: 'B2B-001'
        }});

        // Super Agent
        const [superAgent] = await User.findOrCreate({ where: { username: 'super_agent1' }, defaults: {
            password: await hash('123456'), role: 'SUPER_AGENT', roleId: 10, parentId: b2bSub.id,
            fullName: 'Sumon Haque', phone: '01799999999', status: 'active', referralCode: 'SAG-001', commission_rate: 20
        }});

        // Master Agent
        const [masterAgent] = await User.findOrCreate({ where: { username: 'master_agent1' }, defaults: {
            password: await hash('123456'), role: 'MASTER_AGENT', roleId: 11, parentId: superAgent.id,
            fullName: 'Babul Akter', phone: '01611111111', status: 'active', referralCode: 'MAG-001', commission_rate: 30
        }});

        // Players (5 players)
        const playerNames = [
            { username: 'player_rakib', fullName: 'Rakib Hasan', phone: '01911111111' },
            { username: 'player_siam', fullName: 'Siam Ahmed', phone: '01922222222' },
            { username: 'player_nabil', fullName: 'Nabil Khan', phone: '01933333333' },
            { username: 'player_fahim', fullName: 'Fahim Rahman', phone: '01944444444' },
            { username: 'player_arif', fullName: 'Arif Hossain', phone: '01955555555' },
        ];

        const players = [];
        for (let i = 0; i < playerNames.length; i++) {
            const p = playerNames[i];
            const parent = i < 3 ? affiliate.id : masterAgent.id;
            const [player] = await User.findOrCreate({ where: { username: p.username }, defaults: {
                password: await hash('123456'), role: 'PLAYER', roleId: 12, parentId: parent,
                fullName: p.fullName, phone: p.phone, status: 'active', referralCode: `PLY-${i+1}`
            }});
            players.push(player);
        }

        // Inactive & Bet-locked users for filter demos
        const [inactiveUser] = await User.findOrCreate({ where: { username: 'inactive_user1' }, defaults: {
            password: await hash('123456'), role: 'PLAYER', roleId: 12, parentId: masterAgent.id,
            fullName: 'Blocked User', status: 'inactive', isActive: false, referralCode: 'PLY-BLK'
        }});
        const [betLockedUser] = await User.findOrCreate({ where: { username: 'betlocked_user1' }, defaults: {
            password: await hash('123456'), role: 'PLAYER', roleId: 12, parentId: masterAgent.id,
            fullName: 'BetLock User', status: 'active', isBetLocked: true, referralCode: 'PLY-BL'
        }});
        const [deletedUser] = await User.findOrCreate({ where: { username: 'deleted_user1' }, defaults: {
            password: await hash('123456'), role: 'PLAYER', roleId: 12, parentId: masterAgent.id,
            fullName: 'Deleted User', status: 'deleted', isDeleted: true, referralCode: 'PLY-DEL'
        }});

        const allUsers = [owner, mother, whitelabel, superAdmin, admin, b2cSub, srAffiliate, affiliate, b2bSub, superAgent, masterAgent, ...players, inactiveUser, betLockedUser, deletedUser];
        console.log(`${allUsers.length} users ready`);

        // ==================== 2. WALLETS ====================
        console.log('Creating wallets...');
        const walletBalances = {
            [owner.id]: 1000000, [mother.id]: 500000, [whitelabel.id]: 300000,
            [superAdmin.id]: 200000, [admin.id]: 150000, [b2cSub.id]: 80000,
            [srAffiliate.id]: 50000, [affiliate.id]: 30000, [b2bSub.id]: 80000,
            [superAgent.id]: 60000, [masterAgent.id]: 40000
        };
        players.forEach((p, i) => walletBalances[p.id] = [15000, 8500, 22000, 5000, 12000][i]);
        walletBalances[inactiveUser.id] = 0;
        walletBalances[betLockedUser.id] = 3000;
        walletBalances[deletedUser.id] = 0;

        for (const [userId, balance] of Object.entries(walletBalances)) {
            await Wallet.findOrCreate({ where: { userId }, defaults: {
                userId, balance, totalDeposit: balance * 1.5, totalWithdraw: balance * 0.3
            }});
        }
        console.log(`${Object.keys(walletBalances).length} wallets ready`);

        // ==================== 3. LEAGUES ====================
        console.log('Creating leagues...');
        const leaguesData = [
            { sportId: 1, name: 'Bangladesh Premier League', country: 'Bangladesh' },
            { sportId: 1, name: 'Indian Premier League', country: 'India' },
            { sportId: 1, name: 'ICC World Cup 2026', country: 'International' },
            { sportId: 2, name: 'English Premier League', country: 'England' },
            { sportId: 2, name: 'La Liga', country: 'Spain' },
            { sportId: 2, name: 'FIFA World Cup Qualifiers', country: 'International' },
            { sportId: 3, name: 'Wimbledon 2026', country: 'UK' },
        ];
        const leagues = [];
        for (const l of leaguesData) {
            const [league] = await League.findOrCreate({ where: { name: l.name }, defaults: l });
            leagues.push(league);
        }
        console.log(`${leagues.length} leagues ready`);

        // ==================== 4. MATCHES ====================
        console.log('Creating matches...');
        const matchesData = [
            { leagueId: leagues[0].id, teamA: 'Dhaka Dominators', teamB: 'Chattogram Challengers', status: 'ACTIVE', startTime: new Date(Date.now() + 3600000) },
            { leagueId: leagues[0].id, teamA: 'Sylhet Strikers', teamB: 'Rajshahi Royals', status: 'LIVE', startTime: new Date() },
            { leagueId: leagues[1].id, teamA: 'Mumbai Indians', teamB: 'Chennai Super Kings', status: 'ACTIVE', startTime: new Date(Date.now() + 7200000) },
            { leagueId: leagues[1].id, teamA: 'Royal Challengers', teamB: 'Kolkata Knight Riders', status: 'ACTIVE', startTime: new Date(Date.now() + 86400000) },
            { leagueId: leagues[2].id, teamA: 'Bangladesh', teamB: 'India', status: 'ACTIVE', startTime: new Date(Date.now() + 172800000) },
            { leagueId: leagues[2].id, teamA: 'Australia', teamB: 'England', status: 'INACTIVE', startTime: new Date(Date.now() - 86400000) },
            { leagueId: leagues[3].id, teamA: 'Manchester United', teamB: 'Liverpool', status: 'ACTIVE', startTime: new Date(Date.now() + 3600000*5) },
            { leagueId: leagues[3].id, teamA: 'Arsenal', teamB: 'Chelsea', status: 'LIVE', startTime: new Date() },
            { leagueId: leagues[4].id, teamA: 'Real Madrid', teamB: 'Barcelona', status: 'ACTIVE', startTime: new Date(Date.now() + 3600000*8) },
            { leagueId: leagues[5].id, teamA: 'Brazil', teamB: 'Argentina', status: 'COMPLETED', startTime: new Date(Date.now() - 172800000), homeScore: 2, awayScore: 1 },
            { leagueId: leagues[6].id, teamA: 'Djokovic', teamB: 'Alcaraz', status: 'ACTIVE', startTime: new Date(Date.now() + 86400000*3) },
            { leagueId: leagues[3].id, teamA: 'Manchester City', teamB: 'Tottenham', status: 'BLOCKED', startTime: new Date(Date.now() + 3600000*10) },
        ];
        const matches = [];
        for (const m of matchesData) {
            const [match] = await Match.findOrCreate({ where: { teamA: m.teamA, teamB: m.teamB }, defaults: m });
            matches.push(match);
        }
        console.log(`${matches.length} matches ready`);

        // ==================== 5. MARKETS ====================
        console.log('Creating markets...');
        const marketsCreated = [];
        for (const match of matches) {
            const marketTypes = [
                { name: `${match.teamA} Win`, type: 'WINNER', status: true, matchId: match.id },
                { name: `${match.teamB} Win`, type: 'WINNER', status: true, matchId: match.id },
                { name: 'Draw', type: 'WINNER', status: true, matchId: match.id },
                { name: 'Over 2.5', type: 'OVER_UNDER', status: true, matchId: match.id },
                { name: 'Under 2.5', type: 'OVER_UNDER', status: true, matchId: match.id },
            ];
            // Add fancy for some matches
            if (match.status === 'LIVE' || match.status === 'ACTIVE') {
                marketTypes.push({ name: 'First Goal', type: 'FANCY', status: true, matchId: match.id, isSuspended: false });
                marketTypes.push({ name: 'Total Boundaries', type: 'FANCY', status: true, matchId: match.id, isSuspended: match.status === 'LIVE' });
            }

            for (const mt of marketTypes) {
                const [market] = await Market.findOrCreate({ where: { matchId: mt.matchId, name: mt.name }, defaults: mt });
                marketsCreated.push(market);
            }
        }
        console.log(`${marketsCreated.length} markets ready`);

        // ==================== 6. BETS ====================
        console.log('Creating bets...');
        const betData = [
            // Active/Open bets
            { userId: players[0].id, matchId: matches[0].id, selection: `${matches[0].teamA} Win`, odds: 1.85, stake: 5000, status: 'OPEN' },
            { userId: players[0].id, matchId: matches[1].id, selection: 'Over 2.5', odds: 2.10, stake: 3000, status: 'OPEN' },
            { userId: players[1].id, matchId: matches[0].id, selection: `${matches[0].teamB} Win`, odds: 2.40, stake: 2000, status: 'OPEN' },
            { userId: players[1].id, matchId: matches[2].id, selection: 'Draw', odds: 3.50, stake: 1000, status: 'PENDING' },
            { userId: players[2].id, matchId: matches[3].id, selection: `${matches[3].teamA} Win`, odds: 1.95, stake: 8000, status: 'OPEN' },
            { userId: players[2].id, matchId: matches[6].id, selection: `${matches[6].teamA} Win`, odds: 2.20, stake: 4500, status: 'OPEN' },
            { userId: players[3].id, matchId: matches[7].id, selection: `${matches[7].teamB} Win`, odds: 2.80, stake: 3500, status: 'OPEN' },
            { userId: players[3].id, matchId: matches[4].id, selection: `${matches[4].teamA} Win`, odds: 1.65, stake: 10000, status: 'OPEN' },
            { userId: players[4].id, matchId: matches[8].id, selection: `${matches[8].teamA} Win`, odds: 1.75, stake: 6000, status: 'PENDING' },
            { userId: players[4].id, matchId: matches[1].id, selection: 'Under 2.5', odds: 1.90, stake: 2500, status: 'OPEN' },
            // Won bets (completed match)
            { userId: players[0].id, matchId: matches[9].id, selection: 'Brazil Win', odds: 2.10, stake: 5000, status: 'WON', settledAt: new Date(Date.now() - 86400000) },
            { userId: players[1].id, matchId: matches[9].id, selection: 'Argentina Win', odds: 1.80, stake: 3000, status: 'LOST', settledAt: new Date(Date.now() - 86400000) },
            { userId: players[2].id, matchId: matches[9].id, selection: 'Over 2.5', odds: 2.00, stake: 4000, status: 'WON', settledAt: new Date(Date.now() - 86400000) },
            { userId: players[3].id, matchId: matches[9].id, selection: 'Draw', odds: 3.20, stake: 1500, status: 'LOST', settledAt: new Date(Date.now() - 86400000) },
            // Rejected bet
            { userId: players[4].id, matchId: matches[5].id, selection: 'Australia Win', odds: 1.60, stake: 20000, status: 'REJECTED' },
            // Cheat bet
            { userId: players[0].id, matchId: matches[2].id, selection: 'Mumbai Indians Win', odds: 1.50, stake: 45000, status: 'OPEN', isCheat: true, cheatReason: 'Abnormally high stake pattern detected' },
        ];

        for (const b of betData) {
            b.potentialWin = (b.stake * b.odds).toFixed(2);
            b.liability = ((b.odds - 1) * b.stake).toFixed(2);
            await Bet.findOrCreate({ where: { userId: b.userId, matchId: b.matchId, selection: b.selection, stake: b.stake }, defaults: b });
        }
        console.log(`${betData.length} bets ready`);

        // ==================== 7. TRANSACTIONS ====================
        console.log('Creating transactions...');
        const txns = [
            { userId: players[0].id, type: 'DEPOSIT', amount: 20000, balanceBefore: 0, balanceAfter: 20000, fromId: masterAgent.id, description: 'Initial deposit', status: 'COMPLETED' },
            { userId: players[0].id, type: 'BET_PLACED', amount: 5000, balanceBefore: 20000, balanceAfter: 15000, description: 'Bet on Dhaka vs Chattogram', status: 'COMPLETED' },
            { userId: players[0].id, type: 'BET_WON', amount: 10500, balanceBefore: 15000, balanceAfter: 25500, description: 'Won Brazil vs Argentina', status: 'COMPLETED' },
            { userId: players[1].id, type: 'DEPOSIT', amount: 15000, balanceBefore: 0, balanceAfter: 15000, fromId: affiliate.id, description: 'First deposit', status: 'COMPLETED' },
            { userId: players[1].id, type: 'BET_PLACED', amount: 3000, balanceBefore: 15000, balanceAfter: 12000, description: 'Bet on Brazil match', status: 'COMPLETED' },
            { userId: players[1].id, type: 'BET_LOST', amount: 3000, balanceBefore: 12000, balanceAfter: 12000, description: 'Lost Argentina bet', status: 'COMPLETED' },
            { userId: players[1].id, type: 'WITHDRAW', amount: 5000, balanceBefore: 12000, balanceAfter: 7000, description: 'Withdrawal to Bkash', status: 'COMPLETED' },
            { userId: players[2].id, type: 'DEPOSIT', amount: 30000, balanceBefore: 0, balanceAfter: 30000, fromId: masterAgent.id, description: 'Deposit', status: 'COMPLETED' },
            { userId: players[2].id, type: 'COMMISSION', amount: 1500, balanceBefore: 30000, balanceAfter: 31500, fromId: players[0].id, description: 'Commission from player_rakib', status: 'COMPLETED' },
            { userId: masterAgent.id, type: 'COMMISSION', amount: 3000, balanceBefore: 40000, balanceAfter: 43000, fromId: players[0].id, description: 'Commission 30% from player_rakib win', status: 'COMPLETED' },
            { userId: superAgent.id, type: 'COMMISSION', amount: 2000, balanceBefore: 60000, balanceAfter: 62000, fromId: players[0].id, description: 'Commission 20% from player_rakib win', status: 'COMPLETED' },
            { userId: players[3].id, type: 'DEPOSIT', amount: 10000, balanceBefore: 0, balanceAfter: 10000, fromId: masterAgent.id, description: 'Deposit via agent', status: 'COMPLETED' },
            { userId: players[4].id, type: 'DEPOSIT', amount: 18000, balanceBefore: 0, balanceAfter: 18000, fromId: affiliate.id, description: 'Deposit', status: 'COMPLETED' },
            { userId: players[4].id, type: 'REFUND', amount: 20000, balanceBefore: 18000, balanceAfter: 38000, description: 'Refund for rejected bet', status: 'COMPLETED' },
        ];

        for (const t of txns) {
            await Transaction.findOrCreate({
                where: { userId: t.userId, type: t.type, amount: t.amount, description: t.description },
                defaults: t
            });
        }
        console.log(`${txns.length} transactions ready`);

        // ==================== 8. DEPOSIT REQUESTS ====================
        console.log('Creating deposit requests...');
        const depReqs = [
            { userId: players[0].id, amount: 5000, methodName: 'Bkash', transactionId: 'TXN8847261', status: 'PENDING' },
            { userId: players[1].id, amount: 10000, methodName: 'Nagad', transactionId: 'NGD9928374', status: 'PENDING' },
            { userId: players[2].id, amount: 3000, methodName: 'Rocket', transactionId: 'RKT1123456', status: 'PENDING' },
            { userId: players[3].id, amount: 8000, methodName: 'Bkash', transactionId: 'TXN5567890', status: 'APPROVED', approvedBy: admin.id, processedAt: new Date(Date.now() - 3600000) },
            { userId: players[4].id, amount: 2000, methodName: 'Nagad', transactionId: 'NGD7712345', status: 'REJECTED', approvedBy: admin.id, rejectedReason: 'Invalid transaction ID', processedAt: new Date(Date.now() - 7200000) },
        ];
        for (const d of depReqs) {
            await DepositRequest.findOrCreate({ where: { userId: d.userId, transactionId: d.transactionId }, defaults: d });
        }
        console.log(`${depReqs.length} deposit requests ready`);

        // ==================== 9. WITHDRAW REQUESTS ====================
        console.log('Creating withdraw requests...');
        const wdReqs = [
            { userId: players[0].id, amount: 3000, methodName: 'Bkash', accountNumber: '01911111111', status: 'PENDING' },
            { userId: players[1].id, amount: 5000, methodName: 'Nagad', accountNumber: '01922222222', status: 'PENDING' },
            { userId: players[2].id, amount: 8000, methodName: 'Bkash', accountNumber: '01933333333', status: 'HOLD' },
            { userId: players[4].id, amount: 2000, methodName: 'Rocket', accountNumber: '01955555555', status: 'APPROVED', approvedBy: admin.id, processedAt: new Date(Date.now() - 3600000) },
        ];
        for (const w of wdReqs) {
            await WithdrawRequest.findOrCreate({ where: { userId: w.userId, amount: w.amount, accountNumber: w.accountNumber }, defaults: w });
        }
        console.log(`${wdReqs.length} withdraw requests ready`);

        // ==================== 10. BANKING METHODS ====================
        console.log('Creating banking methods...');
        const methods = [
            { name: 'Personal Bkash', type: 'BKASH', accountNumber: '01711223344', accountName: 'BetX365 Ltd', isActive: true, createdBy: owner.id },
            { name: 'Agent Nagad', type: 'NAGAD', accountNumber: '01811223344', accountName: 'BetX365 Agent', isActive: true, createdBy: owner.id },
            { name: 'Rocket Account', type: 'ROCKET', accountNumber: '01511223344', accountName: 'BetX365', isActive: true, createdBy: owner.id },
            { name: 'USDT Wallet', type: 'CRYPTO', accountNumber: 'TRC20: TXyz...abc123', accountName: 'BetX365 Crypto', isActive: true, createdBy: owner.id },
            { name: 'Bank Transfer', type: 'BANK', accountNumber: 'DBBL-1234567890', accountName: 'BetX365 Ltd', isActive: false, createdBy: owner.id },
        ];
        for (const m of methods) {
            await BankingMethod.findOrCreate({ where: { accountNumber: m.accountNumber }, defaults: m });
        }
        console.log(`${methods.length} banking methods ready`);

        // ==================== 11. MESSAGES ====================
        console.log('Creating messages...');
        const msgs = [
            { type: 'IMPORTANT', title: 'System Maintenance Notice', content: 'System will be under maintenance on Friday 10 PM - 12 AM. Please complete your bets before that.', createdBy: owner.id, isActive: true },
            { type: 'HYPER', title: 'IPL Season Special!', content: 'Get 10% bonus on every deposit during IPL season! Use code: IPL2026', createdBy: owner.id, isActive: true },
            { type: 'IMPORTANT', title: 'New Payment Method Added', content: 'We now accept USDT (TRC20). Minimum deposit: $10', createdBy: admin.id, isActive: true },
            { type: 'USER', title: 'Welcome to BetX365!', content: 'Your account has been created. Deposit now and start winning!', targetUserId: players[0].id, createdBy: admin.id, isActive: true },
            { type: 'IMAGE', title: 'World Cup 2026 Banner', content: 'ICC World Cup starts this month!', imageUrl: 'https://placehold.co/600x200/20c997/white?text=World+Cup+2026', createdBy: owner.id, isActive: true },
            { type: 'HYPER', title: 'Cashback Offer', content: 'Deposit 10,000+ and get 5% cashback instantly!', createdBy: owner.id, isActive: true },
            { type: 'USER', title: 'Bet Lock Warning', content: 'Your account betting has been temporarily locked due to suspicious activity.', targetUserId: betLockedUser.id, createdBy: admin.id, isActive: true },
        ];
        for (const m of msgs) {
            await Message.findOrCreate({ where: { title: m.title, type: m.type }, defaults: m });
        }
        console.log(`${msgs.length} messages ready`);

        // ==================== 12. RESULTS (for completed match) ====================
        console.log('Creating results...');
        await Result.findOrCreate({ where: { matchId: matches[9].id }, defaults: {
            matchId: matches[9].id, winningSelection: 'Brazil Win', declaredBy: owner.id,
            status: 'DECLARED', homeScore: 2, awayScore: 1, declaredAt: new Date(Date.now() - 86400000)
        }});

        // Suspended result
        await Result.findOrCreate({ where: { matchId: matches[5].id, status: 'SUSPENDED' }, defaults: {
            matchId: matches[5].id, winningSelection: 'Australia Win', declaredBy: admin.id,
            status: 'SUSPENDED', suspendedReason: 'Match fixing investigation', declaredAt: new Date(Date.now() - 43200000)
        }});
        console.log('2 results ready');

        // ==================== 13. PLAYER STATS ====================
        console.log('Creating player stats...');
        const statsData = [
            { userId: players[0].id, totalBets: 15, totalWon: 8, totalLost: 6, totalStake: 75000, totalPayout: 92000, winRate: 53.3, totalCommission: 0 },
            { userId: players[1].id, totalBets: 12, totalWon: 5, totalLost: 7, totalStake: 45000, totalPayout: 38000, winRate: 41.7, totalCommission: 0 },
            { userId: players[2].id, totalBets: 20, totalWon: 12, totalLost: 7, totalStake: 120000, totalPayout: 145000, winRate: 60.0, totalCommission: 1500 },
            { userId: players[3].id, totalBets: 8, totalWon: 3, totalLost: 5, totalStake: 30000, totalPayout: 22000, winRate: 37.5, totalCommission: 0 },
            { userId: players[4].id, totalBets: 10, totalWon: 6, totalLost: 3, totalStake: 55000, totalPayout: 65000, winRate: 60.0, totalCommission: 0 },
        ];
        for (const s of statsData) {
            await PlayerStats.findOrCreate({ where: { userId: s.userId }, defaults: { ...s, lastBetAt: new Date() } });
        }
        console.log(`${statsData.length} player stats ready`);

        // ==================== 14. AUDIT LOGS ====================
        console.log('Creating audit logs...');
        const auditLogs = [
            { userId: owner.id, action: 'LOGIN_SUCCESS', ipAddress: '192.168.1.1', userAgent: 'Chrome/120', description: 'Owner logged in' },
            { userId: admin.id, action: 'LOGIN_SUCCESS', ipAddress: '192.168.1.50', userAgent: 'Chrome/120', description: 'Admin logged in' },
            { userId: owner.id, action: 'USER_CREATED', entity: 'User', entityId: mother.id, description: 'Created mother_panel1' },
            { userId: admin.id, action: 'CHIPS_DEPOSITED', entity: 'Wallet', amount: 20000, description: 'Deposited 20000 to player_rakib', ipAddress: '192.168.1.50' },
            { userId: admin.id, action: 'CHIPS_DEPOSITED', entity: 'Wallet', amount: 15000, description: 'Deposited 15000 to player_siam', ipAddress: '192.168.1.50' },
            { userId: owner.id, action: 'MATCH_CREATED', entity: 'Match', entityId: matches[0].id, description: 'Created Dhaka vs Chattogram' },
            { userId: owner.id, action: 'RESULT_DECLARED', entity: 'Result', description: 'Declared Brazil vs Argentina result', ipAddress: '192.168.1.1' },
            { userId: admin.id, action: 'DEPOSIT_APPROVED', entity: 'DepositRequest', amount: 8000, description: 'Approved deposit for player_fahim' },
            { userId: admin.id, action: 'BET_LOCK_TOGGLED', entity: 'User', entityId: betLockedUser.id, description: 'Locked betting for betlocked_user1' },
            { userId: players[0].id, action: 'BET_PLACED', entity: 'Bet', amount: 5000, description: 'Bet on Dhaka Dominators Win', ipAddress: '103.45.67.89' },
            { userId: players[0].id, action: 'BET_PLACED', entity: 'Bet', amount: 45000, description: 'SUSPICIOUS: High stake bet on Mumbai Indians', ipAddress: '103.45.67.89' },
            { userId: players[2].id, action: 'BET_PLACED', entity: 'Bet', amount: 8000, description: 'Bet on Royal Challengers Win', ipAddress: '103.50.60.70' },
            { userId: players[0].id, action: 'LOGIN_SUCCESS', ipAddress: '103.45.67.89', description: 'Player login' },
            { userId: players[0].id, action: 'LOGIN_SUCCESS', ipAddress: '45.22.33.44', description: 'Player login from different IP (multi-login)' },
        ];
        for (const log of auditLogs) {
            await AuditLog.create(log);
        }
        console.log(`${auditLogs.length} audit logs ready`);

        // ==================== 15. NOTIFICATIONS ====================
        console.log('Creating notifications...');
        const notifs = [
            { userId: players[0].id, title: 'Deposit Approved', message: 'Your deposit of ৳8,000 has been approved.', type: 'DEPOSIT' },
            { userId: players[0].id, title: 'Bet Won!', message: 'You won ৳10,500 on Brazil vs Argentina!', type: 'BET', isRead: true },
            { userId: players[1].id, title: 'Withdrawal Processed', message: 'Your withdrawal of ৳5,000 to Nagad has been sent.', type: 'WITHDRAW' },
            { userId: players[2].id, title: 'Commission Earned', message: 'You earned ৳1,500 commission.', type: 'INFO' },
            { userId: betLockedUser.id, title: 'Account Restricted', message: 'Your betting has been locked. Contact support.', type: 'WARNING' },
        ];
        for (const n of notifs) {
            await Notification.create(n);
        }
        console.log(`${notifs.length} notifications ready`);

        console.log('\n========================================');
        console.log('   ALL SAMPLE DATA SEEDED SUCCESSFULLY');
        console.log('========================================');
        console.log(`Users: ${allUsers.length} (Owner to Players)`);
        console.log(`Leagues: ${leagues.length}`);
        console.log(`Matches: ${matches.length} (Active, Live, Completed, Blocked)`);
        console.log(`Markets: ${marketsCreated.length}`);
        console.log(`Bets: ${betData.length} (Open, Won, Lost, Rejected, Cheat)`);
        console.log(`Transactions: ${txns.length}`);
        console.log(`Deposit Requests: ${depReqs.length} (Pending, Approved, Rejected)`);
        console.log(`Withdraw Requests: ${wdReqs.length} (Pending, Hold, Approved)`);
        console.log(`Banking Methods: ${methods.length}`);
        console.log(`Messages: ${msgs.length} (User, Hyper, Important, Image)`);
        console.log(`Results: 2 (Declared, Suspended)`);
        console.log(`Audit Logs: ${auditLogs.length}`);
        console.log('========================================');
        console.log('All users password: 123456');
        console.log('Owner: owner / owner123');
        console.log('========================================\n');

        process.exit(0);
    } catch (err) {
        console.error('Sample Data Error:', err);
        process.exit(1);
    }
}

seedSampleData();
