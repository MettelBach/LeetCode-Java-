class Solution {
    public void rotate(int[] nums, int k) {
        int[] array = new int[nums.length];
        k = k % nums.length;
        
        System.arraycopy(nums, nums.length - k, array, 0, k);
        
        System.arraycopy(nums, 0, array, k, nums.length - k);
        
        System.arraycopy(array, 0, nums, 0, nums.length);
        
        Arrays.stream(nums).forEach(System.out::print);
    }
}