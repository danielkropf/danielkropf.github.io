import { expect,it } from 'vitest'
import { ImportTaskLimiter } from './import-task-limiter'
it('limits concurrent readers and releases queued tasks in FIFO order',async()=>{
 const q=new ImportTaskLimiter(2),order:number[]=[]
 const first=await q.acquire(),second=await q.acquire()
 const third=q.acquire().then(release=>{order.push(3);return release})
 const fourth=q.acquire().then(release=>{order.push(4);return release})
 await Promise.resolve();expect(order).toEqual([])
 first();const releaseThird=await third;expect(order).toEqual([3])
 first();await Promise.resolve();expect(order).toEqual([3])
 second();const releaseFourth=await fourth;expect(order).toEqual([3,4]);releaseThird();releaseFourth()
})
it('a rejected job releases the write lease and does not block subsequent imports',async()=>{
 const q=new ImportTaskLimiter(1)
 await expect(q.run(async()=>{throw new Error('failed')})).rejects.toThrow('failed')
 await expect(q.run(async()=>42)).resolves.toBe(42)
})
