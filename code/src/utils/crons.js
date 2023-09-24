import { scheduleJob } from 'node-schedule'
import { couponModel } from '../../DB/Models/coupon.model.js'
import moment from 'moment-timezone'

//====================  change couponStatus ================
export const changeCouponStatusCron = () => {
  scheduleJob('* * * * * *', async function () {
    const validCoupons = await couponModel.find({ couponStatus: 'Valid' })
    for (const coupon of validCoupons) {
      // toDate  "2023-08-13" => moment()`
      //   console.log({
      //     now: moment(),
      //     toDate: coupon.toDate,
      //     toDateMoment: moment(coupon.toDate),
      //     cond: moment(coupon.toDate).isBefore(moment()),
      //   })
      if (moment(coupon.toDate).isBefore(moment().tz('Africa/Cairo'))) {
        coupon.couponStatus = 'Expired'
      }
      await coupon.save()
    }
    console.log(`Cron of  changeCouponStatusCron() is running ............`)
  })

}

// 2023-08-13T00:00:00+2Z
