const Hero          = require('../collections/hero')
const User          = require('../collections/user')
const Guild         = require('../collections/guild')

const { fetchOnly } = require('./user')
const jikanjs       = require('jikanjs')
const {XPtoLEVEL}   = require('../utils/tools')
const _             = require('lodash')
const colors        = require('../utils/colors')

let hcache = []

const new_hero = async (ctx, user, char) => {
    const pics = await jikanjs.loadCharacter(char.mal_id, 'pictures')

    const hero = await new Hero()
    hero.id = char.mal_id
    hero.name = char.name
    hero.user = user.discord_id
    hero.submitted = new Date()
    hero.pictures = pics.pictures.map(x => x.large)

    hero.accepted = true

    await hero.save()
}

const get_hero = async (ctx, id) => {
    if(hcache.length === 0)
        await reloadCache()

    const hero = hcache.find(x => x.id === id)
    if(hero && hero.followers === -1) {
        hero.followers = await User.countDocuments({ hero: id })
        await hero.save()
    }

    return hero
}

const get_userSumbissions = (ctx, user) => {
    return Hero.find({ user: user.discord_id })
}

const reloadCache = async () => {
    hcache = await Hero.find()
}

const check_heroes = async (ctx, now) => {
    const pending = await Hero.findOne({ accepted: true, active: false })
    if(pending) {
        const user = await fetchOnly(pending.user)
        user.hero = pending.id
        user.herochanged = now
        pending.active = true
        await user.save()
        await pending.save()
        await ctx.direct(user, `congratulations! Your hero request has been accepted.
            Say hello to your new hero **${pending.name}**`)
        await reloadCache()
    }
}

const getInfo = async (ctx, user, id) => {
    const hero = await get_hero(ctx, id)
    return { 
        author: { name: hero.name },
        description: `Level **${XPtoLEVEL(hero.xp)}**\nFollowers: **${hero.followers}**`,
        image: { url: _.sample(hero.pictures) },
        color: colors.blue
    }
}

const withHeroes = (callback) => async (ctx, user, ...args) => {
    if(hcache.length === 0)
        await reloadCache()

    let list
    if(args.length > 0) {
        const reg = new RegExp(args.join('.*'), 'gi')
        list = hcache.filter(x => reg.test(x.name))
    } else list = hcache

    if(list.length === 0)
        return ctx.reply(user, `no heroes found matching that request`, 'red')
    
    return callback(ctx, user, list)
}

const checkGuildLoyalty = async (ctx) => {
    const heroq = ctx.guild.buildings.find(x => x.id === 'heroq' && x.health > 50)
    if(!heroq) return;

    const now = new Date()
    const guildusers = ctx.guild.userstats.map(x => x.id)
    const guildheroes = await User.find({discord_id: {$in: guildusers}}, 'discord_id hero')
    if(guildheroes.length === 0) return;

    const heroscores = {}
    guildheroes.filter(x => x.hero).map(x => {
        const usr = ctx.guild.userstats.find(y => y.id === x.discord_id)
        heroscores[x.hero] = heroscores[x.hero] + usr.rank || usr.rank
    })

    let highest = 0
    do {
        highest = Object.keys(heroscores).reduce((a, b) => heroscores[a] > heroscores[b]? a : b)

        const targetHero = await get_hero(ctx, highest)
        const ourScore = heroscores[highest]
        delete(heroscores[highest])

        const otherGuild = await Guild.findOne({ hero: highest, id: { $ne: ctx.guild.id } })
        const otherScore = await getGuildScore(ctx, otherGuild, highest)

        if(ourScore >= otherScore) {
            if(highest === ctx.guild.hero) {
                ctx.guild.heroloyalty = Math.min(ctx.guild.heroloyalty + 1, 3)
                await ctx.guild.save()
                
                return ctx.send(ctx.guild.reportchannel, {
                    author: { name: `Guild hero status` },
                    description: `Hero **${targetHero.name}** is securing position in this guild with loyalty level **${ctx.guild.heroloyalty}**!`,
                    color: colors.green
                })
            }

            if(otherGuild && otherGuild.heroloyalty > 0) {
                otherGuild.heroloyalty--
                await otherGuild.save()

                ctx.send(otherGuild.reportchannel, {
                    author: { name: `Hero alert` },
                    description: `Another guild is changing loyalty of **${targetHero.name}** by having more followers!
                        To keep current guild hero increase amount of followers or upgrade hero residence.
                        Loyalty points left: **${otherGuild.heroloyalty}**`,
                    color: colors.yellow
                })

                return ctx.send(ctx.guild.reportchannel, {
                    author: { name: `Guild hero status` },
                    description: `This guild is successfully changing loyalty of **${targetHero.name}** in other guild by having more followers.
                        When loyalty points reach **0** this hero will transition to **${ctx.discord_guild.name}**.
                        This will also replace current guild hero (if any).
                        Only **${otherGuild.heroloyalty}** more point(s) left!`,
                    color: colors.green
                })

            } else if(otherGuild && otherGuild.heroloyalty < 0) {
                otherGuild.heroloyalty = 0
                otherGuild.hero = ''
                await otherGuild.save()

                ctx.send(otherGuild.reportchannel, {
                    author: { name: `Hero lost!` },
                    description: `Unfortunately all loyalty points for **${targetHero.name}** have been lost...
                        This hero is now part of another guild.
                        Another hero will be assigned to this guild soon`,
                    color: colors.red
                })
            }

            if(ctx.guild.hero && ctx.guild.heroloyalty > 1) {
                ctx.guild.heroloyalty--
                await ctx.guild.save()

                const curHero = await get_hero(ctx, ctx.guild.hero)
                return ctx.send(ctx.guild.reportchannel, {
                    author: { name: `Hero replacement` },
                    description: `Hero **${targetHero.name}** has more followers than current hero **${curHero.name}**.
                        Loyalty points of current hero started to decrease and are now at **${ctx.guild.heroloyalty}**
                        Once points reach 0 guild hero will be changed to **${targetHero.name}**`,
                    color: colors.yellow
                })
            }

            ctx.guild.heroloyalty = 1
            ctx.guild.hero = highest
            await ctx.guild.save()

            return ctx.send(ctx.guild.reportchannel, {
                author: { name: `New hero has arrived` },
                description: `**${targetHero.name}** is now part of **${ctx.discord_guild.name}**!
                    This hero automatically gets one point of loyalty.
                    Loyalty will increase if amount of followers in this guild will be higher than in others.`,
                color: colors.green
            })

        } else {
            if(ctx.guild.hero === highest) {
                return ctx.send(otherGuild.reportchannel, {
                    author: { name: `Hero alert` },
                    description: `Another guild has larger amount of **${targetHero.name}** followers.
                        This will not change hero loyalty, but it might start draining it one day.
                        To keep current guild hero increase amount of followers or upgrade hero residence.`,
                    color: colors.yellow
                })
            }

            if(ctx.guild.hero) {
                const curHero = await get_hero(ctx, ctx.guild.hero)
                return ctx.send(otherGuild.reportchannel, {
                    author: { name: `Hero status` },
                    description: `Hero **${targetHero.name}** has more followers than current hero **${curHero.name}**.
                        However, there is not enough influence for **${targetHero.name}** to change current guild.
                        Loyalty points will not change`,
                    color: colors.yellow
                })
            }
        }

    } while(Object.keys(heroscores).length > 0)

    return ctx.send(ctx.guild.reportchannel, {
        author: { name: `Failed to find guild hero` },
        description: `All heroes that have followers in this guild have more followers in other guilds.
            To get a guild hero, increase amount of followers for certain hero and upgrade **Hero Quaters**`,
        color: colors.red
    })
}

const getGuildScore = async (ctx, guild, heroID) => {
    if(!guild || !heroID)
        return 0

    const guildusers = guild.userstats.map(x => x.id)
    const guildheroes = await User.find({discord_id: {$in: guildusers}}, 'discord_id hero')

    let score = 0
    guildheroes.filter(x => x.hero === heroID).map(x => {
        const usr = guild.userstats.find(y => y.id === x.discord_id)
        score += usr.xp
    })

    return score
}

module.exports = {
    new_hero,
    get_hero,
    get_userSumbissions,
    check_heroes,
    withHeroes,
    getInfo,
    checkGuildLoyalty
}