import { couponModel } from '../../DB/Models/coupon.model.js'
import moment from 'moment-timezone'

export const couponValidationFunction = async ({
  couponCode,
  userId,
  next,
} = {}) => {
  // couponCode check
  const coupon = await couponModel.findOne({ couponCode })
  if (!coupon) {
    return {
      msg: 'please enter valid couponCode',
    }
  }

  // expiration
  if (
    coupon.couponStatus == 'Expired' ||
    moment(new Date(coupon.toDate)).isBefore(moment().tz('Africa/Cairo'))
  ) {
    return {
      msg: 'this coupon is expired',
    }
  }
  // coupon not started yet
  if (
    coupon.couponStatus == 'Valid' &&
    moment().isBefore(moment(new Date(coupon.fromDate)).tz('Africa/Cairo'))
  ) {
    return {
      msg: 'this coupon is not started yet',
    }
  }

  let notAssginedusers = []
  let exceedMaxCount = false
  for (const user of coupon.couponAssginedToUsers) {
    // coupon not assgined to this user
    notAssginedusers.push(user.userId.toString())
    // user exceed maxUsage for this coupon
    if (userId.toString() == user.userId.toString()) {
      if (user.maxUsage <= user.usageCount) {
        exceedMaxCount = true
      }
    }
  }

  if (!notAssginedusers.includes(userId.toString())) {
    return {
      notAssgined: true,
      msg: 'this is not assgined to you',
    }
  }
  if (exceedMaxCount) {
    return {
      exceedMaxCount: true,
      msg: 'the max usage is exceed',
    }
  }

  return true
}
